"use strict";(()=>{function b(n){let t=n.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);if(t)return{owner:t[1],repo:t[2],number:parseInt(t[3],10),type:"issue"};let e=n.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);return e?{owner:e[1],repo:e[2],number:parseInt(e[3],10),type:"pr"}:null}var u={gray:"#6b7280",yellow:"#eab308",green:"#22c55e",red:"#ef4444",blue:"#3b82f6",purple:"#a855f7",pink:"#ec4899",orange:"#f97316"},k={todo:"To-do",in_progress:"In Progress",complete:"Complete"},h=["todo","in_progress","complete"];function p(n){return chrome.runtime.sendMessage(n)}function v(){return document.documentElement.getAttribute("data-color-mode")==="dark"||document.documentElement.getAttribute("data-dark-theme")==="dark"||document.documentElement.classList.contains("dark")}function g(n){return u[n]??u.gray}var l=class{container;shadow;root;task=null;statuses=[];dropdownOpen=!1;loading=!0;error=null;owner;repo;number;constructor(t,e,r){this.owner=t,this.repo=e,this.number=r,this.container=document.createElement("div"),this.container.id="tasker-status-widget",this.shadow=this.container.attachShadow({mode:"closed"}),this.root=document.createElement("div"),this.shadow.appendChild(this.root);let s=document.createElement("style");s.textContent=this.getStyles(),this.shadow.appendChild(s),document.addEventListener("click",o=>{!this.container.contains(o.target)&&this.dropdownOpen&&(this.dropdownOpen=!1,this.render())})}get element(){return this.container}async init(){this.loading=!0,this.error=null,this.render();try{let t=await p({type:"GET_SESSION"});if(!t.ok||!t.data){this.loading=!1,this.error="Not signed in to Tasker",this.render();return}let[e,r]=await Promise.all([p({type:"QUERY_TASK",owner:this.owner,repo:this.repo,number:this.number}),p({type:"QUERY_STATUSES"})]);e.ok?this.task=e.data??null:this.error=e.error??"Failed to load task",r.ok&&r.data&&(this.statuses=r.data)}catch(t){this.error=t.message??"Connection error"}this.loading=!1,this.render()}render(){let t=v();if(this.root.innerHTML="",this.root.className=`tasker-root ${t?"dark":"light"}`,this.loading){this.root.innerHTML='<div class="section"><div class="header">Tasker</div><div class="spinner-wrap"><div class="spinner"></div></div></div>';return}if(this.error){this.root.innerHTML=`
        <div class="section">
          <div class="header">Tasker</div>
          <div class="error-msg">${this.escapeHtml(this.error)}</div>
          <button class="retry-btn">Retry</button>
        </div>`,this.root.querySelector(".retry-btn")?.addEventListener("click",()=>this.init());return}if(!this.task){this.renderAddButton();return}this.renderStatusBadge()}renderAddButton(){let t=document.createElement("div");t.className="section",t.innerHTML='<div class="header">Tasker</div>';let e=document.createElement("button");e.className="add-btn",e.textContent="Add to Tasker",e.addEventListener("click",async()=>{e.disabled=!0,e.textContent="Adding...";let r=await p({type:"CREATE_TASK",owner:this.owner,repo:this.repo,number:this.number});r.ok&&r.data?(this.task=r.data,this.render()):(e.textContent=r.error??"Failed",setTimeout(()=>{e.disabled=!1,e.textContent="Add to Tasker"},2e3))}),t.appendChild(e),this.root.appendChild(t)}renderStatusBadge(){let t=this.task,e=this.statuses.find(i=>i.key===t.status),r=g(e?e.color:"gray"),s=e?.label??t.status,o=document.createElement("div");o.className="section",o.innerHTML='<div class="header">Tasker</div>';let a=document.createElement("button");a.className="status-badge",a.innerHTML=`
      <span class="dot" style="background:${r}"></span>
      <span class="label">${this.escapeHtml(s)}</span>
      <span class="chevron">${this.dropdownOpen?"&#9650;":"&#9660;"}</span>
    `,a.addEventListener("click",i=>{i.stopPropagation(),this.dropdownOpen=!this.dropdownOpen,this.render()}),o.appendChild(a),this.dropdownOpen&&o.appendChild(this.renderDropdown()),this.root.appendChild(o)}renderDropdown(){let t=document.createElement("div");t.className="dropdown";let e=this.groupStatuses();for(let r of h){let s=e[r];if(!s||s.length===0)continue;let o=document.createElement("div");o.className="group-label",o.textContent=k[r],t.appendChild(o);for(let a of s){let i=document.createElement("button");i.className=`status-row ${this.task?.status===a.key?"active":""}`,i.innerHTML=`
          <span class="dot" style="background:${g(a.color)}"></span>
          <span class="label">${this.escapeHtml(a.label)}</span>
        `,i.addEventListener("click",async x=>{x.stopPropagation(),await this.updateStatus(a.key,a.group_name)}),t.appendChild(i)}}return t}async updateStatus(t,e){if(!this.task)return;let r=this.task.status,s=this.task.status_group;this.task.status=t,this.task.status_group=e,this.dropdownOpen=!1,this.render();let o=await p({type:"UPDATE_STATUS",taskId:this.task.id,status:t,statusGroup:e});o.ok||(this.task.status=r,this.task.status_group=s,this.error=o.error??"Update failed",this.render(),setTimeout(()=>{this.error=null,this.render()},3e3))}groupStatuses(){let t={todo:[],in_progress:[],complete:[]};for(let e of this.statuses)t[e.group_name]?.push(e);for(let e of h)t[e].sort((r,s)=>r.position-s.position);return t}escapeHtml(t){let e=document.createElement("span");return e.textContent=t,e.innerHTML}destroy(){this.container.remove()}getStyles(){return`
      .tasker-root {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
        font-size: 12px;
        line-height: 1.5;
        margin-top: 16px;
      }

      .tasker-root.dark {
        color: #e6edf3;
      }
      .tasker-root.light {
        color: #1f2328;
      }

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

      .label {
        flex: 1;
      }

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
    `}};var d=null,c="";function w(){return document.querySelector('[class*="sidebarContent"]')??document.querySelector(".Layout-sidebar .BorderGrid")??null}function m(){let n=window.location.href;if(n===c)return;c=n,d&&(d.destroy(),d=null);let t=b(n);if(!t)return;let e=(r=0)=>{let s=w();if(!s){r<20&&setTimeout(()=>e(r+1),250);return}d=new l(t.owner,t.repo,t.number),s.appendChild(d.element),d.init()};e()}m();document.addEventListener("turbo:load",()=>{c="",m()});var f=window.location.href;setInterval(()=>{window.location.href!==f&&(f=window.location.href,c="",m())},1e3);})();
