"use strict";(()=>{function T(a){let e=a.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/?(?:\?.*)?(?:#.*)?$/);return e?{owner:e[1],repo:e[2]}:null}function E(a){let e=a.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);if(e)return{owner:e[1],repo:e[2],number:parseInt(e[3],10),type:"issue"};let t=a.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);return t?{owner:t[1],repo:t[2],number:parseInt(t[3],10),type:"pr"}:null}var g={gray:"#6b7280",yellow:"#eab308",green:"#22c55e",red:"#ef4444",blue:"#3b82f6",purple:"#a855f7",pink:"#ec4899",orange:"#f97316"},y={todo:"To-do",in_progress:"In Progress",complete:"Complete"},k=["todo","in_progress","complete"];function c(a){return chrome.runtime.sendMessage(a)}function C(){return document.documentElement.getAttribute("data-color-mode")==="dark"||document.documentElement.getAttribute("data-dark-theme")==="dark"||document.documentElement.classList.contains("dark")}function h(a){return g[a]??g.gray}var f=class{container;shadow;root;task=null;linkedTasks=[];statuses=[];dropdownOpen=!1;loading=!0;error=null;owner;repo;number;mode;linkedIssueNumbers;constructor(e,t,s,o="issue",n=[]){this.owner=e,this.repo=t,this.number=s,this.mode=o,this.linkedIssueNumbers=n,this.container=document.createElement("div"),this.container.id="tasker-status-widget",o==="pr"&&(this.container.style.display="inline-flex",this.container.style.alignItems="center",this.container.style.flexShrink="0",this.container.style.alignSelf="start",this.container.style.position="relative"),this.shadow=this.container.attachShadow({mode:"closed"}),this.root=document.createElement("div"),this.shadow.appendChild(this.root);let r=document.createElement("style");r.textContent=this.mode==="pr"?this.getHeaderStyles():this.getSidebarStyles(),this.shadow.appendChild(r),document.addEventListener("click",i=>{!this.container.contains(i.target)&&this.dropdownOpen&&(this.dropdownOpen=!1,this.render())})}get element(){return this.container}async init(){this.loading=!0,this.error=null,this.render();try{let e=await c({type:"GET_SESSION"});if(!e.ok||!e.data){this.loading=!1,this.error="Not signed in to Tasker",this.render();return}this.mode==="pr"?await this.initPr():await this.initIssue()}catch(e){this.error=e.message??"Connection error"}this.loading=!1,this.render()}async initIssue(){let[e,t]=await Promise.all([c({type:"QUERY_TASK",owner:this.owner,repo:this.repo,number:this.number}),c({type:"QUERY_STATUSES"})]);e.ok?this.task=e.data??null:this.error=e.error??"Failed to load task",t.ok&&t.data&&(this.statuses=t.data)}async initPr(){if(this.linkedIssueNumbers.length===0){this.error="No linked issues found";return}let[e,t]=await Promise.all([c({type:"QUERY_TASKS_BATCH",owner:this.owner,repo:this.repo,issueNumbers:this.linkedIssueNumbers}),c({type:"QUERY_STATUSES"})]);e.ok?this.linkedTasks=e.data??[]:this.error=e.error??"Failed to load tasks",t.ok&&t.data&&(this.statuses=t.data)}render(){this.mode==="pr"?this.renderPr():this.renderSidebar()}renderPr(){let e=C();if(this.root.innerHTML="",this.root.className=`tasker-header ${e?"dark":"light"}`,this.loading){this.root.innerHTML='<button class="tasker-btn" disabled><div class="spinner"></div> Tasker</button>';return}if(this.error){this.root.innerHTML="";return}this.linkedTasks.length!==0&&this.renderPrStatusBadge()}renderPrStatusBadge(){let t=new Set(this.linkedTasks.map(d=>d.status)).size>1,s,o,n;if(t)o=g.purple,n="Mixed";else{let d=this.linkedTasks[0].status;s=this.statuses.find(p=>p.key===d),o=h(s?s.color:"gray"),n=s?.label??d}let r=document.createElement("div");r.className="tasker-wrapper";let i=document.createElement("button");i.className="tasker-btn has-status",i.innerHTML=`
      <span class="tasker-icon">T</span>
      <span class="dot" style="background:${o}"></span>
      <span class="status-label">${this.escapeHtml(n)}</span>
      <span class="linked-count">${this.linkedTasks.length} issue${this.linkedTasks.length>1?"s":""}</span>
      <span class="chevron">${this.dropdownOpen?"&#9650;":"&#9660;"}</span>
    `,i.addEventListener("click",d=>{d.stopPropagation(),this.dropdownOpen=!this.dropdownOpen,this.render()}),r.appendChild(i),this.root.appendChild(r),this.dropdownOpen&&this.root.appendChild(this.renderPrDropdown())}renderPrDropdown(){let e=document.createElement("div");e.className="dropdown";let t=document.createElement("div");t.className="linked-notice",t.innerHTML=`Updating <strong>${this.linkedTasks.length}</strong> tracked issue${this.linkedTasks.length>1?"s":""}: ${this.linkedTasks.map(o=>`#${o.issue_number}`).join(", ")}`,e.appendChild(t);let s=this.groupStatuses();for(let o of k){let n=s[o];if(!n||n.length===0)continue;let r=document.createElement("div");r.className="group-label",r.textContent=y[o],e.appendChild(r);for(let i of n){let d=this.linkedTasks.every(w=>w.status===i.key),p=document.createElement("button");p.className=`status-row ${d?"active":""}`,p.innerHTML=`
          <span class="dot" style="background:${h(i.color)}"></span>
          <span class="label">${this.escapeHtml(i.label)}</span>
        `,p.addEventListener("click",async w=>{w.stopPropagation(),await this.updateLinkedStatuses(i.key,i.group_name)}),e.appendChild(p)}}return e}async updateLinkedStatuses(e,t){let s=this.linkedTasks.map(r=>({status:r.status,group:r.status_group}));for(let r of this.linkedTasks)r.status=e,r.status_group=t;this.dropdownOpen=!1,this.render();let o=this.linkedTasks.map(r=>r.issue_number).filter(r=>r!==null),n=await c({type:"UPDATE_LINKED_STATUSES",owner:this.owner,repo:this.repo,issueNumbers:o,status:e,statusGroup:t});n.ok||(this.linkedTasks.forEach((r,i)=>{r.status=s[i].status,r.status_group=s[i].group}),this.error=n.error??"Update failed",this.render(),setTimeout(()=>{this.error=null,this.render()},3e3))}renderSidebar(){let e=C();if(this.root.innerHTML="",this.root.className=`tasker-root ${e?"dark":"light"}`,this.loading){this.root.innerHTML='<div class="section"><div class="header">Tasker</div><div class="spinner-wrap"><div class="spinner"></div></div></div>';return}if(this.error){this.root.innerHTML=`
        <div class="section">
          <div class="header">Tasker</div>
          <div class="error-msg">${this.escapeHtml(this.error)}</div>
          <button class="retry-btn">Retry</button>
        </div>`,this.root.querySelector(".retry-btn")?.addEventListener("click",()=>this.init());return}if(!this.task){this.renderAddButton();return}this.renderStatusBadge()}renderAddButton(){let e=document.createElement("div");e.className="section",e.innerHTML='<div class="header">Tasker</div>';let t=document.createElement("button");t.className="add-btn",t.textContent="Add to Tasker",t.addEventListener("click",async()=>{t.disabled=!0,t.textContent="Adding...";let s=await c({type:"CREATE_TASK",owner:this.owner,repo:this.repo,number:this.number});s.ok&&s.data?(this.task=s.data,this.render()):(t.textContent=s.error??"Failed",setTimeout(()=>{t.disabled=!1,t.textContent="Add to Tasker"},2e3))}),e.appendChild(t),this.root.appendChild(e)}renderStatusBadge(){let e=this.task,t=this.statuses.find(i=>i.key===e.status),s=h(t?t.color:"gray"),o=t?.label??e.status,n=document.createElement("div");n.className="section",n.innerHTML='<div class="header">Tasker</div>';let r=document.createElement("button");r.className="status-badge",r.innerHTML=`
      <span class="dot" style="background:${s}"></span>
      <span class="label">${this.escapeHtml(o)}</span>
      <span class="chevron">${this.dropdownOpen?"&#9650;":"&#9660;"}</span>
    `,r.addEventListener("click",i=>{i.stopPropagation(),this.dropdownOpen=!this.dropdownOpen,this.render()}),n.appendChild(r),this.dropdownOpen&&n.appendChild(this.renderDropdown()),this.root.appendChild(n)}renderDropdown(){let e=document.createElement("div");e.className="dropdown";let t=this.groupStatuses();for(let s of k){let o=t[s];if(!o||o.length===0)continue;let n=document.createElement("div");n.className="group-label",n.textContent=y[s],e.appendChild(n);for(let r of o){let i=document.createElement("button");i.className=`status-row ${this.task?.status===r.key?"active":""}`,i.innerHTML=`
          <span class="dot" style="background:${h(r.color)}"></span>
          <span class="label">${this.escapeHtml(r.label)}</span>
        `,i.addEventListener("click",async d=>{d.stopPropagation(),await this.updateStatus(r.key,r.group_name)}),e.appendChild(i)}}return e}async updateStatus(e,t){if(!this.task)return;let s=this.task.status,o=this.task.status_group;this.task.status=e,this.task.status_group=t,this.dropdownOpen=!1,this.render();let n=await c({type:"UPDATE_STATUS",taskId:this.task.id,status:e,statusGroup:t});n.ok||(this.task.status=s,this.task.status_group=o,this.error=n.error??"Update failed",this.render(),setTimeout(()=>{this.error=null,this.render()},3e3))}groupStatuses(){let e={todo:[],in_progress:[],complete:[]};for(let t of this.statuses)e[t.group_name]?.push(t);for(let t of k)e[t].sort((s,o)=>s.position-o.position);return e}escapeHtml(e){let t=document.createElement("span");return t.textContent=e,t.innerHTML}destroy(){this.container.remove()}getHeaderStyles(){return`
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
    `}};var L="extensionSettings";var u={autoRefreshEnabled:!1,autoRefreshSeconds:20,notifyHelpWanted:!1,notifyChannels:["browser"],telegramChatId:"",pollSeconds:45},N=["browser","telegram"];function A(a){if(!Array.isArray(a))return[...u.notifyChannels];let e=a.filter(t=>typeof t=="string"&&N.includes(t));return e.length>0?Array.from(new Set(e)):[...u.notifyChannels]}async function S(){let e=(await chrome.storage.local.get(L))[L];return{autoRefreshEnabled:e?.autoRefreshEnabled??u.autoRefreshEnabled,autoRefreshSeconds:Math.max(5,e?.autoRefreshSeconds??u.autoRefreshSeconds),notifyHelpWanted:e?.notifyHelpWanted??u.notifyHelpWanted,notifyChannels:A(e?.notifyChannels),telegramChatId:e?.telegramChatId??u.telegramChatId,pollSeconds:Math.max(30,e?.pollSeconds??u.pollSeconds)}}function R(a,e){return`seenHelpWanted:${a.toLowerCase()}/${e.toLowerCase()}`}async function H(a,e){let t=R(a,e),o=(await chrome.storage.local.get(t))[t]??[];return new Set(o)}async function _(a,e,t){let s=Array.from(t),o=s.length>500?s.slice(s.length-500):s;await chrome.storage.local.set({[R(a,e)]:o})}var P=/help[\s-]?wanted/i;function I(){let a=new Map,e=new Set;document.querySelectorAll('[data-testid="list-view-item"], [data-testid="list-view-items"] > li, div[id^="issue_"], li[id^="issue_"]').forEach(t=>e.add(t)),e.size===0&&document.querySelectorAll('a[href*="/issues/"]').forEach(t=>{let s=t.closest('li, article, div[role="listitem"]');s&&e.add(s)});for(let t of e){let s=(t.textContent??"").toLowerCase();if(!P.test(s))continue;let o=t.querySelector('a[data-testid="issue-pr-title-link"], a[id^="issue_"][href*="/issues/"], a[href*="/issues/"]');if(!o)continue;let n=o.href,r=n.match(/\/issues\/(\d+)(?:[?#].*)?$/);if(!r)continue;let i=parseInt(r[1],10);if(!Number.isFinite(i)||i<=0||a.has(i))continue;let d=(o.textContent??"").trim()||`Issue #${i}`;a.set(i,{number:i,title:d,url:n})}return Array.from(a.values())}var b=class{constructor(e,t){this.owner=e;this.repo=t}refreshTimer=null;scanTimer=null;destroyed=!1;async init(){this.scanTimer=window.setTimeout(()=>{this.runScan(!0)},1500);let e=await S();if(e.autoRefreshEnabled){let t=Math.max(5,e.autoRefreshSeconds)*1e3;this.refreshTimer=window.setTimeout(()=>{this.destroyed||window.location.reload()},t)}}async runScan(e){if(!this.destroyed)try{let t=I(),s=await H(this.owner,this.repo),n=(await S()).notifyHelpWanted,r=t.filter(d=>!s.has(d.number));if(r.length===0)return;let i=s.size===0&&e;for(let d of r)s.add(d.number);if(await _(this.owner,this.repo,s),i||!n)return;for(let d of r.slice(0,10)){let p={type:"SEND_HELP_WANTED",owner:this.owner,repo:this.repo,number:d.number,title:d.title,url:d.url};chrome.runtime.sendMessage(p).catch(()=>{})}}catch{}}destroy(){this.destroyed=!0,this.refreshTimer!==null&&(clearTimeout(this.refreshTimer),this.refreshTimer=null),this.scanTimer!==null&&(clearTimeout(this.scanTimer),this.scanTimer=null)}};var l=null,m=null,x="";function U(){return document.querySelector('[class*="sidebarContent"]')??document.querySelector(".Layout-sidebar .BorderGrid")??null}function O(){return document.querySelector('[class*="PageHeader-Description"] .d-flex.flex-justify-between')??null}function $(){let a=document.querySelector(".js-comment-body")??document.querySelector('[data-testid="issue-body"]');if(!a)return[];let e=new Set,t=a.querySelectorAll('a[href*="/issues/"]');for(let n of t){let i=n.href.match(/\/issues\/(\d+)/);i&&e.add(parseInt(i[1],10))}let o=(a.textContent??"").matchAll(/#(\d{2,})/g);for(let n of o)e.add(parseInt(n[1],10));return Array.from(e)}function v(){let a=window.location.href;if(a===x)return;x=a,l&&(l.destroy(),l=null),m&&(m.destroy(),m=null);let e=T(a);if(e){m=new b(e.owner,e.repo),m.init();return}let t=E(a);if(!t)return;let s=(o=0)=>{if(t.type==="pr"){let n=O();if(!n){o<20&&setTimeout(()=>s(o+1),250);return}let r=$();l=new f(t.owner,t.repo,t.number,"pr",r),n.appendChild(l.element),l.init()}else{let n=U();if(!n){o<20&&setTimeout(()=>s(o+1),250);return}l=new f(t.owner,t.repo,t.number,"issue",[]),n.appendChild(l.element),l.init()}};s()}v();document.addEventListener("turbo:load",()=>{x="",v()});var M=window.location.href;setInterval(()=>{window.location.href!==M&&(M=window.location.href,x="",v())},1e3);})();
