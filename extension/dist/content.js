"use strict";(()=>{function T(o){let e=o.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/?(?:\?.*)?(?:#.*)?$/);return e?{owner:e[1],repo:e[2]}:null}function E(o){let e=o.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);if(e)return{owner:e[1],repo:e[2],number:parseInt(e[3],10),type:"issue"};let t=o.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);return t?{owner:t[1],repo:t[2],number:parseInt(t[3],10),type:"pr"}:null}var b={gray:"#6b7280",yellow:"#eab308",green:"#22c55e",red:"#ef4444",blue:"#3b82f6",purple:"#a855f7",pink:"#ec4899",orange:"#f97316"},y={todo:"To-do",in_progress:"In Progress",complete:"Complete"},k=["todo","in_progress","complete"];function h(o){return chrome.runtime.sendMessage(o)}function L(){return document.documentElement.getAttribute("data-color-mode")==="dark"||document.documentElement.getAttribute("data-dark-theme")==="dark"||document.documentElement.classList.contains("dark")}function f(o){return b[o]??b.gray}var g=class{container;shadow;root;task=null;linkedTasks=[];statuses=[];dropdownOpen=!1;loading=!0;error=null;owner;repo;number;mode;linkedIssueNumbers;constructor(e,t,s,r="issue",i=[]){this.owner=e,this.repo=t,this.number=s,this.mode=r,this.linkedIssueNumbers=i,this.container=document.createElement("div"),this.container.id="tasker-status-widget",r==="pr"&&(this.container.style.display="inline-flex",this.container.style.alignItems="center",this.container.style.flexShrink="0",this.container.style.alignSelf="start",this.container.style.position="relative"),this.shadow=this.container.attachShadow({mode:"closed"}),this.root=document.createElement("div"),this.shadow.appendChild(this.root);let n=document.createElement("style");n.textContent=this.mode==="pr"?this.getHeaderStyles():this.getSidebarStyles(),this.shadow.appendChild(n),document.addEventListener("click",a=>{!this.container.contains(a.target)&&this.dropdownOpen&&(this.dropdownOpen=!1,this.render())})}get element(){return this.container}async init(){this.loading=!0,this.error=null,this.render();try{let e=await h({type:"GET_SESSION"});if(!e.ok||!e.data){this.loading=!1,this.error="Not signed in to Tasker",this.render();return}this.mode==="pr"?await this.initPr():await this.initIssue()}catch(e){this.error=e.message??"Connection error"}this.loading=!1,this.render()}async initIssue(){let[e,t]=await Promise.all([h({type:"QUERY_TASK",owner:this.owner,repo:this.repo,number:this.number}),h({type:"QUERY_STATUSES"})]);e.ok?this.task=e.data??null:this.error=e.error??"Failed to load task",t.ok&&t.data&&(this.statuses=t.data)}async initPr(){if(this.linkedIssueNumbers.length===0){this.error="No linked issues found";return}let[e,t]=await Promise.all([h({type:"QUERY_TASKS_BATCH",owner:this.owner,repo:this.repo,issueNumbers:this.linkedIssueNumbers}),h({type:"QUERY_STATUSES"})]);e.ok?this.linkedTasks=e.data??[]:this.error=e.error??"Failed to load tasks",t.ok&&t.data&&(this.statuses=t.data)}render(){this.mode==="pr"?this.renderPr():this.renderSidebar()}renderPr(){let e=L();if(this.root.innerHTML="",this.root.className=`tasker-header ${e?"dark":"light"}`,this.loading){this.root.innerHTML='<button class="tasker-btn" disabled><div class="spinner"></div> Tasker</button>';return}if(this.error){this.root.innerHTML="";return}this.linkedTasks.length!==0&&this.renderPrStatusBadge()}renderPrStatusBadge(){let t=new Set(this.linkedTasks.map(d=>d.status)).size>1,s,r,i;if(t)r=b.purple,i="Mixed";else{let d=this.linkedTasks[0].status;s=this.statuses.find(l=>l.key===d),r=f(s?s.color:"gray"),i=s?.label??d}let n=document.createElement("div");n.className="tasker-wrapper";let a=document.createElement("button");a.className="tasker-btn has-status",a.innerHTML=`
      <span class="tasker-icon">T</span>
      <span class="dot" style="background:${r}"></span>
      <span class="status-label">${this.escapeHtml(i)}</span>
      <span class="linked-count">${this.linkedTasks.length} issue${this.linkedTasks.length>1?"s":""}</span>
      <span class="chevron">${this.dropdownOpen?"&#9650;":"&#9660;"}</span>
    `,a.addEventListener("click",d=>{d.stopPropagation(),this.dropdownOpen=!this.dropdownOpen,this.render()}),n.appendChild(a),this.root.appendChild(n),this.dropdownOpen&&this.root.appendChild(this.renderPrDropdown())}renderPrDropdown(){let e=document.createElement("div");e.className="dropdown";let t=document.createElement("div");t.className="linked-notice",t.innerHTML=`Updating <strong>${this.linkedTasks.length}</strong> tracked issue${this.linkedTasks.length>1?"s":""}: ${this.linkedTasks.map(r=>`#${r.issue_number}`).join(", ")}`,e.appendChild(t);let s=this.groupStatuses();for(let r of k){let i=s[r];if(!i||i.length===0)continue;let n=document.createElement("div");n.className="group-label",n.textContent=y[r],e.appendChild(n);for(let a of i){let d=this.linkedTasks.every(c=>c.status===a.key),l=document.createElement("button");l.className=`status-row ${d?"active":""}`,l.innerHTML=`
          <span class="dot" style="background:${f(a.color)}"></span>
          <span class="label">${this.escapeHtml(a.label)}</span>
        `,l.addEventListener("click",async c=>{c.stopPropagation(),await this.updateLinkedStatuses(a.key,a.group_name)}),e.appendChild(l)}}return e}async updateLinkedStatuses(e,t){let s=this.linkedTasks.map(n=>({status:n.status,group:n.status_group}));for(let n of this.linkedTasks)n.status=e,n.status_group=t;this.dropdownOpen=!1,this.render();let r=this.linkedTasks.map(n=>n.issue_number).filter(n=>n!==null),i=await h({type:"UPDATE_LINKED_STATUSES",owner:this.owner,repo:this.repo,issueNumbers:r,status:e,statusGroup:t});i.ok||(this.linkedTasks.forEach((n,a)=>{n.status=s[a].status,n.status_group=s[a].group}),this.error=i.error??"Update failed",this.render(),setTimeout(()=>{this.error=null,this.render()},3e3))}renderSidebar(){let e=L();if(this.root.innerHTML="",this.root.className=`tasker-root ${e?"dark":"light"}`,this.loading){this.root.innerHTML='<div class="section"><div class="header">Tasker</div><div class="spinner-wrap"><div class="spinner"></div></div></div>';return}if(this.error){this.root.innerHTML=`
        <div class="section">
          <div class="header">Tasker</div>
          <div class="error-msg">${this.escapeHtml(this.error)}</div>
          <button class="retry-btn">Retry</button>
        </div>`,this.root.querySelector(".retry-btn")?.addEventListener("click",()=>this.init());return}if(!this.task){this.renderAddButton();return}this.renderStatusBadge()}renderAddButton(){let e=document.createElement("div");e.className="section",e.innerHTML='<div class="header">Tasker</div>';let t=document.createElement("button");t.className="add-btn",t.textContent="Add to Tasker",t.addEventListener("click",async()=>{t.disabled=!0,t.textContent="Adding...";let s=await h({type:"CREATE_TASK",owner:this.owner,repo:this.repo,number:this.number});s.ok&&s.data?(this.task=s.data,this.render()):(t.textContent=s.error??"Failed",setTimeout(()=>{t.disabled=!1,t.textContent="Add to Tasker"},2e3))}),e.appendChild(t),this.root.appendChild(e)}renderStatusBadge(){let e=this.task,t=this.statuses.find(a=>a.key===e.status),s=f(t?t.color:"gray"),r=t?.label??e.status,i=document.createElement("div");i.className="section",i.innerHTML='<div class="header">Tasker</div>';let n=document.createElement("button");n.className="status-badge",n.innerHTML=`
      <span class="dot" style="background:${s}"></span>
      <span class="label">${this.escapeHtml(r)}</span>
      <span class="chevron">${this.dropdownOpen?"&#9650;":"&#9660;"}</span>
    `,n.addEventListener("click",a=>{a.stopPropagation(),this.dropdownOpen=!this.dropdownOpen,this.render()}),i.appendChild(n),this.dropdownOpen&&i.appendChild(this.renderDropdown()),this.root.appendChild(i)}renderDropdown(){let e=document.createElement("div");e.className="dropdown";let t=this.groupStatuses();for(let s of k){let r=t[s];if(!r||r.length===0)continue;let i=document.createElement("div");i.className="group-label",i.textContent=y[s],e.appendChild(i);for(let n of r){let a=document.createElement("button");a.className=`status-row ${this.task?.status===n.key?"active":""}`,a.innerHTML=`
          <span class="dot" style="background:${f(n.color)}"></span>
          <span class="label">${this.escapeHtml(n.label)}</span>
        `,a.addEventListener("click",async d=>{d.stopPropagation(),await this.updateStatus(n.key,n.group_name)}),e.appendChild(a)}}return e}async updateStatus(e,t){if(!this.task)return;let s=this.task.status,r=this.task.status_group;this.task.status=e,this.task.status_group=t,this.dropdownOpen=!1,this.render();let i=await h({type:"UPDATE_STATUS",taskId:this.task.id,status:e,statusGroup:t});i.ok||(this.task.status=s,this.task.status_group=r,this.error=i.error??"Update failed",this.render(),setTimeout(()=>{this.error=null,this.render()},3e3))}groupStatuses(){let e={todo:[],in_progress:[],complete:[]};for(let t of this.statuses)e[t.group_name]?.push(t);for(let t of k)e[t].sort((s,r)=>s.position-r.position);return e}escapeHtml(e){let t=document.createElement("span");return t.textContent=e,t.innerHTML}destroy(){this.container.remove()}getHeaderStyles(){return`
      .tasker-header {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
        font-size: 12px;
        line-height: 1.5;
        position: relative;
      }

      .tasker-wrapper {
        display: flex;
        align-items: center;
        gap: 0;
      }

      .tasker-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 5px 12px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        border: 1px solid transparent;
        transition: all 0.15s;
        white-space: nowrap;
      }

      .tasker-header.light .tasker-btn {
        background: #f6f8fa;
        color: #24292f;
        border-color: #d1d9e0;
      }
      .tasker-header.light .tasker-btn:hover {
        background: #eaeef2;
      }
      .tasker-header.dark .tasker-btn {
        background: #21262d;
        color: #e6edf3;
        border-color: #3d444d;
      }
      .tasker-header.dark .tasker-btn:hover {
        background: #292e36;
      }

      .tasker-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .tasker-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 18px;
        height: 18px;
        background: #2563eb;
        color: #fff;
        border-radius: 4px;
        font-weight: 800;
        font-size: 11px;
        flex-shrink: 0;
      }

      .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
      }

      .status-label {
        max-width: 120px;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .linked-count {
        font-size: 10px;
        padding: 1px 6px;
        border-radius: 10px;
        font-weight: 600;
      }
      .tasker-header.light .linked-count {
        background: #dbeafe;
        color: #1d4ed8;
      }
      .tasker-header.dark .linked-count {
        background: #1e3a5f;
        color: #93c5fd;
      }

      .chevron {
        font-size: 8px;
        opacity: 0.5;
        margin-left: 2px;
      }

      .linked-notice {
        font-size: 11px;
        padding: 6px 10px;
        font-weight: 500;
        border-radius: 4px;
        margin-bottom: 4px;
      }
      .linked-notice strong {
        font-weight: 700;
      }
      .tasker-header.light .linked-notice {
        background: #dbeafe;
        color: #1d4ed8;
      }
      .tasker-header.dark .linked-notice {
        background: #1e3a5f;
        color: #93c5fd;
      }

      .dropdown {
        position: absolute;
        top: 100%;
        right: 0;
        min-width: 220px;
        border-radius: 8px;
        padding: 4px;
        z-index: 100;
        box-shadow: 0 4px 24px rgba(0,0,0,0.16);
        margin-top: 4px;
        max-height: 300px;
        overflow-y: auto;
      }
      .tasker-header.light .dropdown {
        background: #fff;
        border: 1px solid #d1d9e0;
      }
      .tasker-header.dark .dropdown {
        background: #2d333b;
        border: 1px solid #3d444d;
      }

      .group-label {
        font-size: 11px;
        font-weight: 600;
        padding: 6px 8px 2px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        opacity: 0.6;
      }

      .status-row {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 8px;
        border: none;
        border-radius: 4px;
        background: transparent;
        cursor: pointer;
        width: 100%;
        text-align: left;
        font-size: 12px;
        color: inherit;
      }
      .tasker-header.light .status-row:hover { background: #f6f8fa; }
      .tasker-header.dark .status-row:hover { background: #373e47; }
      .status-row.active { font-weight: 600; }

      .label { flex: 1; }

      .spinner {
        width: 14px;
        height: 14px;
        border: 2px solid #d1d9e0;
        border-top-color: #2563eb;
        border-radius: 50%;
        animation: spin 0.6s linear infinite;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
    `}getSidebarStyles(){return`
      .tasker-root {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
        font-size: 12px;
        line-height: 1.5;
        margin-top: 16px;
      }

      .tasker-root.dark { color: #e6edf3; }
      .tasker-root.light { color: #1f2328; }

      .section {
        border-top: 1px solid var(--border);
        padding-top: 16px;
        position: relative;
      }
      .tasker-root.light .section { border-color: #d1d9e0; }
      .tasker-root.dark .section { border-color: #3d444d; }

      .header {
        font-size: 12px;
        font-weight: 600;
        margin-bottom: 8px;
      }
      .tasker-root.light .header { color: #1f2328; }
      .tasker-root.dark .header { color: #e6edf3; }

      .status-badge {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 8px;
        border: 1px solid transparent;
        border-radius: 6px;
        background: transparent;
        cursor: pointer;
        width: 100%;
        text-align: left;
        font-size: 12px;
        color: inherit;
        transition: background 0.1s;
      }
      .tasker-root.light .status-badge:hover { background: #f6f8fa; }
      .tasker-root.dark .status-badge:hover { background: #21262d; }

      .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
      }

      .label { flex: 1; }

      .chevron {
        font-size: 8px;
        opacity: 0.5;
      }

      .dropdown {
        position: absolute;
        bottom: 100%;
        left: 0;
        right: 0;
        border-radius: 8px;
        padding: 4px;
        z-index: 100;
        box-shadow: 0 -4px 24px rgba(0,0,0,0.16);
        max-height: 300px;
        overflow-y: auto;
        margin-bottom: 4px;
      }
      .tasker-root.light .dropdown {
        background: #fff;
        border: 1px solid #d1d9e0;
      }
      .tasker-root.dark .dropdown {
        background: #2d333b;
        border: 1px solid #3d444d;
      }

      .group-label {
        font-size: 11px;
        font-weight: 600;
        padding: 6px 8px 2px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        opacity: 0.6;
      }

      .status-row {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 8px;
        border: none;
        border-radius: 4px;
        background: transparent;
        cursor: pointer;
        width: 100%;
        text-align: left;
        font-size: 12px;
        color: inherit;
      }
      .tasker-root.light .status-row:hover { background: #f6f8fa; }
      .tasker-root.dark .status-row:hover { background: #373e47; }
      .status-row.active { font-weight: 600; }

      .add-btn {
        display: block;
        width: 100%;
        padding: 6px 12px;
        border: 1px solid #d1d9e0;
        border-radius: 6px;
        background: transparent;
        color: inherit;
        font-size: 12px;
        cursor: pointer;
        transition: background 0.1s;
      }
      .tasker-root.dark .add-btn { border-color: #3d444d; }
      .add-btn:hover { background: #f6f8fa; }
      .tasker-root.dark .add-btn:hover { background: #21262d; }
      .add-btn:disabled { opacity: 0.5; cursor: not-allowed; }

      .error-msg {
        font-size: 12px;
        color: #cf222e;
        margin-bottom: 6px;
      }
      .tasker-root.dark .error-msg { color: #f85149; }

      .retry-btn {
        font-size: 11px;
        padding: 2px 8px;
        border: 1px solid #d1d9e0;
        border-radius: 4px;
        background: transparent;
        color: inherit;
        cursor: pointer;
      }
      .tasker-root.dark .retry-btn { border-color: #3d444d; }

      .spinner-wrap {
        display: flex;
        justify-content: center;
        padding: 8px 0;
      }
      .spinner {
        width: 16px;
        height: 16px;
        border: 2px solid #d1d9e0;
        border-top-color: #3b82f6;
        border-radius: 50%;
        animation: spin 0.6s linear infinite;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
    `}};var C="extensionSettings";var p={autoRefreshEnabled:!1,autoRefreshSeconds:20,notifyHelpWanted:!1,notifyChannels:["browser"],telegramChatId:"",pollSeconds:45,watchedLabels:["Help Wanted","Daily","Bug"],excludedLabels:["DeployBlocker","DeployBlockerCash"]},P=["browser","telegram"];function U(o){if(!Array.isArray(o))return[...p.notifyChannels];let e=o.filter(t=>typeof t=="string"&&P.includes(t));return e.length>0?Array.from(new Set(e)):[...p.notifyChannels]}function R(o,e){if(!Array.isArray(o))return[...e];let t=o.filter(s=>typeof s=="string").map(s=>s.trim()).filter(s=>s.length>0&&s.length<=64);return Array.from(new Map(t.map(s=>[s.toLowerCase(),s])).values())}async function S(){let e=(await chrome.storage.local.get(C))[C];return{autoRefreshEnabled:e?.autoRefreshEnabled??p.autoRefreshEnabled,autoRefreshSeconds:Math.max(5,e?.autoRefreshSeconds??p.autoRefreshSeconds),notifyHelpWanted:e?.notifyHelpWanted??p.notifyHelpWanted,notifyChannels:U(e?.notifyChannels),telegramChatId:e?.telegramChatId??p.telegramChatId,pollSeconds:Math.max(30,e?.pollSeconds??p.pollSeconds),watchedLabels:e?.watchedLabels===void 0?[...p.watchedLabels]:R(e.watchedLabels,[]),excludedLabels:e?.excludedLabels===void 0?[...p.excludedLabels]:R(e.excludedLabels,[])}}function H(o,e){return`seenHelpWanted:${o.toLowerCase()}/${e.toLowerCase()}`}async function M(o,e){let t=H(o,e),r=(await chrome.storage.local.get(t))[t]??[];return new Set(r)}async function _(o,e,t){let s=Array.from(t),r=s.length>500?s.slice(s.length-500):s;await chrome.storage.local.set({[H(o,e)]:r})}function O(o){return o.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}function A(o){let e=O(o).replace(/\s+/g,"[\\s-]?");return new RegExp(`(?:^|[^a-z0-9])${e}(?:$|[^a-z0-9])`,"i")}function $(o,e){let t=[];for(let s of e)A(s).test(o)&&t.push(s);return t}function D(o,e){for(let t of e)if(A(t).test(o))return!0;return!1}function z(o,e){let t=new Map;if(o.length===0)return[];let s=new Set;document.querySelectorAll('[data-testid="list-view-item"], [data-testid="list-view-items"] > li, div[id^="issue_"], li[id^="issue_"]').forEach(r=>s.add(r)),s.size===0&&document.querySelectorAll('a[href*="/issues/"]').forEach(r=>{let i=r.closest('li, article, div[role="listitem"]');i&&s.add(i)});for(let r of s){let i=r.textContent??"";if(D(i,e))continue;let n=$(i,o);if(n.length===0)continue;let a=r.querySelector('a[data-testid="issue-pr-title-link"], a[id^="issue_"][href*="/issues/"], a[href*="/issues/"]');if(!a)continue;let d=a.href,l=d.match(/\/issues\/(\d+)(?:[?#].*)?$/);if(!l)continue;let c=parseInt(l[1],10);if(!Number.isFinite(c)||c<=0||t.has(c))continue;let I=(a.textContent??"").trim()||`Issue #${c}`;t.set(c,{number:c,title:I,url:d,labels:n})}return Array.from(t.values())}var x=class{constructor(e,t){this.owner=e;this.repo=t}refreshTimer=null;scanTimer=null;destroyed=!1;async init(){this.scanTimer=window.setTimeout(()=>{this.runScan(!0)},1500);let e=await S();if(e.autoRefreshEnabled){let t=Math.max(5,e.autoRefreshSeconds)*1e3;this.refreshTimer=window.setTimeout(()=>{this.destroyed||window.location.reload()},t)}}async runScan(e){if(!this.destroyed)try{let t=await S(),s=z(t.watchedLabels,t.excludedLabels),r=await M(this.owner,this.repo),i=t.notifyHelpWanted,n=s.filter(d=>!r.has(d.number));if(n.length===0)return;let a=r.size===0&&e;for(let d of n)r.add(d.number);if(await _(this.owner,this.repo,r),a||!i)return;for(let d of n.slice(0,10)){let l={type:"SEND_HELP_WANTED",owner:this.owner,repo:this.repo,number:d.number,title:d.title,url:d.url,labels:d.labels};chrome.runtime.sendMessage(l).catch(()=>{})}}catch{}}destroy(){this.destroyed=!0,this.refreshTimer!==null&&(clearTimeout(this.refreshTimer),this.refreshTimer=null),this.scanTimer!==null&&(clearTimeout(this.scanTimer),this.scanTimer=null)}};var u=null,m=null,w="";function G(){return document.querySelector('[class*="sidebarContent"]')??document.querySelector(".Layout-sidebar .BorderGrid")??null}function W(){return document.querySelector('[class*="PageHeader-Description"] .d-flex.flex-justify-between')??null}function B(){let o=document.querySelector(".js-comment-body")??document.querySelector('[data-testid="issue-body"]');if(!o)return[];let e=new Set,t=o.querySelectorAll('a[href*="/issues/"]');for(let i of t){let a=i.href.match(/\/issues\/(\d+)/);a&&e.add(parseInt(a[1],10))}let r=(o.textContent??"").matchAll(/#(\d{2,})/g);for(let i of r)e.add(parseInt(i[1],10));return Array.from(e)}function v(){let o=window.location.href;if(o===w)return;w=o,u&&(u.destroy(),u=null),m&&(m.destroy(),m=null);let e=T(o);if(e){m=new x(e.owner,e.repo),m.init();return}let t=E(o);if(!t)return;let s=(r=0)=>{if(t.type==="pr"){let i=W();if(!i){r<20&&setTimeout(()=>s(r+1),250);return}let n=B();u=new g(t.owner,t.repo,t.number,"pr",n),i.appendChild(u.element),u.init()}else{let i=G();if(!i){r<20&&setTimeout(()=>s(r+1),250);return}u=new g(t.owner,t.repo,t.number,"issue",[]),i.appendChild(u.element),u.init()}};s()}v();document.addEventListener("turbo:load",()=>{w="",v()});var N=window.location.href;setInterval(()=>{window.location.href!==N&&(N=window.location.href,w="",v())},1e3);})();
