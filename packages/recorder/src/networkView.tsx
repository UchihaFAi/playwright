/*
  Copyright (c) Microsoft Corporation.

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/

import type { NetworkRequestBody, NetworkRequestDetails, NetworkRequestSummary } from './recorderTypes';
import { CodeMirrorWrapper } from '@web/components/codeMirrorWrapper';
import { SplitView } from '@web/components/splitView';
import { TabbedPane } from '@web/components/tabbedPane';
import { ToolbarButton } from '@web/components/toolbarButton';
import { copy } from '@web/uiUtils';
import * as React from 'react';
import './networkView.css';

// Keep in sync with the server-side limit in recorderNetwork.ts.
const kMaxRequests = 100;

export interface NetworkViewProps {
  requests: NetworkRequestSummary[],
  details: NetworkRequestDetails | null,
}

export const NetworkView: React.FC<NetworkViewProps> = ({ requests, details }) => {
  const [selectedId, setSelectedId] = React.useState<string | undefined>();
  const [filter, setFilter] = React.useState('');
  const [detailsTab, setDetailsTab] = React.useState('response');

  const visibleRequests = React.useMemo(() => {
    const text = filter.trim().toLowerCase();
    return text ? requests.filter(request => request.url.toLowerCase().includes(text)) : requests;
  }, [requests, filter]);
  const selected = requests.find(request => request.id === selectedId);

  // Bodies arrive after the response finishes, so refresh the details when the summary changes.
  React.useEffect(() => {
    if (selectedId)
      window.dispatch({ event: 'networkRequestDetails', params: { id: selectedId } }).catch(() => {});
  }, [selectedId, selected?.status, selected?.responseSize, selected?.failure]);

  const list = <div className='network-list vbox'>
    <div className='network-filters'>
      <input className='network-filter' type='search' placeholder='Filter URL' spellCheck={false} value={filter} onChange={event => setFilter(event.target.value)} />
      <span className='network-count' title='Only the latest Fetch/XHR requests are kept'>{requests.length} / {kMaxRequests}</span>
      <ToolbarButton icon='clear-all' title='Clear network log' disabled={!requests.length} onClick={() => {
        setSelectedId(undefined);
        window.dispatch({ event: 'clearNetwork' }).catch(() => {});
      }}></ToolbarButton>
    </div>
    <div className='network-table-container'>
      {visibleRequests.length ? <table className='network-table'>
        <thead>
          <tr><th>Status</th><th>Method</th><th>Path</th><th>Type</th><th className='network-number'>Size</th><th className='network-number'>Time</th></tr>
        </thead>
        <tbody>
          {visibleRequests.map(request => <tr
            key={request.id}
            className={request.id === selectedId ? 'selected' : undefined}
            onClick={() => setSelectedId(request.id)}
            data-testid='network-request'
          >
            <td className={isError(request) ? 'network-error' : undefined}>{statusText(request)}</td>
            <td>{request.method}</td>
            <td className='network-path' title={request.url}>{urlPath(request.url)}{request.addedToScript && <span className='codicon codicon-check network-added' title='Added to script'></span>}</td>
            <td>{request.resourceType}</td>
            <td className='network-number'>{request.responseSize === undefined ? '' : formatSize(request.responseSize)}</td>
            <td className='network-number'>{request.duration === undefined ? '' : `${Math.round(request.duration)} ms`}</td>
          </tr>)}
        </tbody>
      </table> : <div className='network-empty'>{requests.length ? 'No requests match the filter' : 'Fetch/XHR requests of the recorded page will appear here'}</div>}
    </div>
  </div>;

  const requestDetails = selected && details?.id === selected.id ? details : undefined;
  const detailsView = selected && <div className='network-details vbox'>
    <div className='network-details-header'>
      <span className='network-details-title' title={selected.url}>
        <span className={isError(selected) ? 'network-error' : 'network-ok'}>{statusText(selected)}</span> {selected.method} {urlPath(selected.url)}
      </span>
      <button
        className='button network-add'
        disabled={selected.addedToScript || selected.status === undefined}
        title={selected.status === undefined ? 'Only requests with a response can be checked' : 'Check in the script that this request is sent and returns this status'}
        onClick={() => window.dispatch({ event: 'addNetworkRequest', params: { id: selected.id } }).catch(() => {})}
      >
        <span className={'codicon ' + (selected.addedToScript ? 'codicon-check' : 'codicon-add')}></span>
        {selected.addedToScript ? 'Added to script' : 'Add to script'}
      </button>
    </div>
    {selected.addError && <div className='network-add-error'>{selected.addError}</div>}
    <TabbedPane
      selectedTab={detailsTab}
      setSelectedTab={setDetailsTab}
      tabs={[
        {
          id: 'headers',
          title: 'Headers',
          render: () => <HeadersView request={selected} details={requestDetails} />,
        },
        {
          id: 'payload',
          title: 'Payload',
          render: () => <BodyView body={requestDetails?.requestBody} loading={!requestDetails} emptyText='No request body' />,
        },
        {
          id: 'response',
          title: 'Response',
          render: () => <BodyView
            body={requestDetails?.responseBody}
            loading={!requestDetails}
            emptyText={selected.failure ? `Request failed: ${selected.failure}` : selected.status === undefined ? 'Waiting for the response…' : 'No response body'} />,
        },
      ]}
    />
  </div>;

  return <SplitView
    sidebarSize={380}
    orientation='horizontal'
    sidebarHidden={!selected}
    main={list}
    sidebar={detailsView}
  />;
};

const HeadersView: React.FC<{ request: NetworkRequestSummary, details: NetworkRequestDetails | undefined }> = ({ request, details }) => {
  const general = [
    { name: 'URL', value: request.url },
    { name: 'Method', value: request.method },
    { name: 'Status', value: statusText(request) },
  ];
  return <div className='network-headers'>
    <HeaderSection title='General' headers={general} />
    {details && <HeaderSection title='Request headers' headers={details.requestHeaders} />}
    {details && <HeaderSection title='Response headers' headers={details.responseHeaders} />}
  </div>;
};

const HeaderSection: React.FC<{ title: string, headers: { name: string, value: string }[] }> = ({ title, headers }) => {
  return <div className='network-header-section'>
    <div className='network-header-section-title'>{title}</div>
    {headers.length ? headers.map((header, index) => <div key={index} className='network-header'>
      <span className='network-header-name'>{header.name}:</span> <span className='network-header-value'>{header.value}</span>
    </div>) : <div className='network-header network-muted'>None</div>}
  </div>;
};

const BodyView: React.FC<{ body: NetworkRequestBody | undefined, loading: boolean, emptyText: string }> = ({ body, loading, emptyText }) => {
  if (loading)
    return <div className='network-empty'>Loading…</div>;
  if (!body || !body.size)
    return <div className='network-empty'>{emptyText}</div>;
  if (body.text === undefined)
    return <div className='network-empty'>{body.size > 1024 * 1024 ? 'Body is larger than 1 MB' : 'Binary content'} · {body.mimeType || 'unknown type'} · {formatSize(body.size)}</div>;
  const { text, mimeType } = formatBody(body);
  return <div className='network-body vbox'>
    <div className='network-body-toolbar'>
      <span className='network-muted'>{body.mimeType || 'text'} · {formatSize(body.size)}</span>
      <ToolbarButton icon='files' title='Copy' onClick={() => copy(text)}></ToolbarButton>
    </div>
    <CodeMirrorWrapper text={text} mimeType={mimeType} readOnly={true} lineNumbers={true} wrapLines={true} />
  </div>;
};

// JSON is pretty-printed even when it is sent as text/plain, like fetch() with a string body.
function formatBody(body: NetworkRequestBody): { text: string, mimeType: string } {
  const text = body.text || '';
  try {
    return { text: JSON.stringify(JSON.parse(text), null, 2), mimeType: 'application/json' };
  } catch {
    return { text, mimeType: body.mimeType || 'text/plain' };
  }
}

function statusText(request: NetworkRequestSummary): string {
  if (request.failure)
    return 'failed';
  return request.status === undefined ? '…' : String(request.status);
}

function isError(request: NetworkRequestSummary): boolean {
  return !!request.failure || (request.status !== undefined && request.status >= 400);
}

function urlPath(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname + parsed.search;
  } catch {
    return url;
  }
}

function formatSize(size: number): string {
  if (size < 1024)
    return `${size} B`;
  if (size < 1024 * 1024)
    return `${(size / 1024).toFixed(1)} kB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
