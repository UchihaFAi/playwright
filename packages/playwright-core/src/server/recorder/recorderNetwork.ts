/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { EventEmitter } from 'events';

import { eventsHelper, monotonicTime } from '../../utils';
import { BrowserContext } from '../browserContext';

import type { RegisteredListener } from '../../utils';
import type * as network from '../network';
import type { NetworkRequestBody, NetworkRequestDetails, NetworkRequestSummary } from '@recorder/recorderTypes';

const kMaxEntries = 100;
const kMaxBodySize = 1024 * 1024;

type NetworkEntry = {
  summary: NetworkRequestSummary;
  request: network.Request;
  startTime: number;
  responseHeaders: { name: string, value: string }[];
  responseBody?: NetworkRequestBody;
};

// Keeps the latest API (fetch/xhr) requests of the recorded context for the Network tab.
export class RecorderNetwork extends EventEmitter {
  static Events = {
    Change: 'change',
  };

  private _entries: NetworkEntry[] = [];
  private _entryByRequest = new Map<network.Request, NetworkEntry>();
  private _lastId = 0;
  private _listeners: RegisteredListener[];
  private _changeTimer: NodeJS.Timeout | undefined;

  constructor(context: BrowserContext) {
    super();
    this._listeners = [
      eventsHelper.addEventListener(context, BrowserContext.Events.Request, (request: network.Request) => this._onRequest(request)),
      eventsHelper.addEventListener(context, BrowserContext.Events.Response, (response: network.Response) => this._onResponse(response)),
      eventsHelper.addEventListener(context, BrowserContext.Events.RequestFinished, ({ request, response }: { request: network.Request, response: network.Response | null }) => this._onRequestFinished(request, response)),
      eventsHelper.addEventListener(context, BrowserContext.Events.RequestFailed, (request: network.Request) => this._onRequestFailed(request)),
    ];
  }

  dispose() {
    eventsHelper.removeEventListeners(this._listeners);
    if (this._changeTimer)
      clearTimeout(this._changeTimer);
  }

  requests(): NetworkRequestSummary[] {
    return this._entries.map(entry => ({ ...entry.summary }));
  }

  entry(id: string): { summary: NetworkRequestSummary, startTime: number } | undefined {
    return this._entries.find(entry => entry.summary.id === id);
  }

  details(id: string): NetworkRequestDetails | null {
    const entry = this._entries.find(entry => entry.summary.id === id);
    if (!entry)
      return null;
    const postData = entry.request.postDataBuffer();
    return {
      id,
      requestHeaders: entry.request.headers(),
      responseHeaders: entry.responseHeaders,
      requestBody: postData ? toBody(postData, entry.request.headerValue('content-type')) : undefined,
      responseBody: entry.responseBody,
    };
  }

  markAdded(id: string, error?: string) {
    const entry = this._entries.find(entry => entry.summary.id === id);
    if (!entry)
      return;
    entry.summary.addedToScript = !error;
    entry.summary.addError = error;
    this._scheduleChange();
  }

  // The recorded script was cleared, so nothing is in it anymore.
  resetAdded() {
    for (const entry of this._entries) {
      entry.summary.addedToScript = undefined;
      entry.summary.addError = undefined;
    }
    this._scheduleChange();
  }

  clear() {
    this._entries = [];
    this._entryByRequest.clear();
    this._scheduleChange();
  }

  private _onRequest(request: network.Request) {
    if (!['fetch', 'xhr'].includes(request.resourceType()) || request.serviceWorker())
      return;
    const entry: NetworkEntry = {
      summary: {
        id: String(++this._lastId),
        method: request.method(),
        url: request.url(),
        resourceType: request.resourceType(),
      },
      request,
      startTime: monotonicTime(),
      responseHeaders: [],
    };
    this._entries.push(entry);
    this._entryByRequest.set(request, entry);
    if (this._entries.length > kMaxEntries)
      this._entryByRequest.delete(this._entries.shift()!.request);
    this._scheduleChange();
  }

  private _onResponse(response: network.Response) {
    const entry = this._entryByRequest.get(response.request());
    if (!entry)
      return;
    entry.summary.status = response.status();
    entry.responseHeaders = response.headers();
    this._scheduleChange();
  }

  private _onRequestFinished(request: network.Request, response: network.Response | null) {
    const entry = this._entryByRequest.get(request);
    if (!entry)
      return;
    entry.summary.duration = monotonicTime() - entry.startTime;
    this._scheduleChange();
    if (!response)
      return;
    response.body().then(body => {
      entry.responseBody = toBody(body, response.headerValue('content-type'));
      entry.summary.responseSize = body.length;
      this._scheduleChange();
    }, () => {
      // Redirects and evicted resources have no body.
    });
  }

  private _onRequestFailed(request: network.Request) {
    const entry = this._entryByRequest.get(request);
    if (!entry)
      return;
    entry.summary.failure = request.failure()?.errorText || 'Failed';
    entry.summary.duration = monotonicTime() - entry.startTime;
    this._scheduleChange();
  }

  private _scheduleChange() {
    if (this._changeTimer)
      return;
    this._changeTimer = setTimeout(() => {
      this._changeTimer = undefined;
      this.emit(RecorderNetwork.Events.Change, this.requests());
    }, 50);
  }
}

function toBody(buffer: Buffer, mimeType: string | undefined): NetworkRequestBody {
  const body: NetworkRequestBody = { mimeType: mimeType || '', size: buffer.length };
  if (buffer.length <= kMaxBodySize && isTextMimeType(body.mimeType))
    body.text = buffer.toString('utf8');
  return body;
}

function isTextMimeType(mimeType: string): boolean {
  // Bodies sent without a content type, like fetch() with a string body, are text too.
  if (!mimeType)
    return true;
  return /^text\//i.test(mimeType) || /^application\/([\w.-]+\+)?(json|xml|javascript|x-www-form-urlencoded|graphql)\b/i.test(mimeType);
}
