"use strict";(()=>{function U(r){let t=r.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/?(?:\?.*)?(?:#.*)?$/);return t?{owner:t[1],repo:t[2]}:null}function z(r){let t=r.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);if(t)return{owner:t[1],repo:t[2],number:parseInt(t[3],10),type:"issue"};let e=r.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);return e?{owner:e[1],repo:e[2],number:parseInt(e[3],10),type:"pr"}:null}var C={gray:"#6b7280",yellow:"#eab308",green:"#22c55e",red:"#ef4444",blue:"#3b82f6",purple:"#a855f7",pink:"#ec4899",orange:"#f97316"},N={todo:"To-do",in_progress:"In Progress",complete:"Complete"},R=["todo","in_progress","complete"];var V=["bug","daily"],X="help wanted",K=2e3;function c(r){return chrome.runtime.sendMessage(r)}function $(){return document.documentElement.getAttribute("data-color-mode")==="dark"||document.documentElement.getAttribute("data-dark-theme")==="dark"||document.documentElement.classList.contains("dark")}function S(r){return C[r]??C.gray}var P=class{container;shadow;root;task=null;linkedTasks=[];statuses=[];dropdownOpen=!1;loading=!0;error=null;owner;repo;number;mode;linkedIssueNumbers;labels=[];proposal=null;proposalDraftBody="";proposalBusy=!1;proposalPollHandle=null;proposalNotice=null;destroyed=!1;autoPostEnabled=!0;constructor(t,e,s,o="issue",a=[]){this.owner=t,this.repo=e,this.number=s,this.mode=o,this.linkedIssueNumbers=a,this.container=document.createElement("div"),this.container.id="tasker-status-widget",o==="pr"&&(this.container.style.display="inline-flex",this.container.style.alignItems="center",this.container.style.flexShrink="0",this.container.style.alignSelf="start",this.container.style.position="relative"),this.shadow=this.container.attachShadow({mode:"closed"}),this.root=document.createElement("div"),this.shadow.appendChild(this.root);let n=document.createElement("style");n.textContent=this.mode==="pr"?this.getHeaderStyles():this.getSidebarStyles(),this.shadow.appendChild(n),document.addEventListener("click",l=>{!this.container.contains(l.target)&&this.dropdownOpen&&(this.dropdownOpen=!1,this.render())})}get element(){return this.container}async init(){this.loading=!0,this.error=null,this.render();try{let t=await c({type:"GET_SESSION"});if(!t.ok||!t.data){this.loading=!1,this.error="Not signed in to Tasker",this.render();return}this.mode==="pr"?await this.initPr():await this.initIssue()}catch(t){this.error=t.message??"Connection error"}this.loading=!1,this.render()}async initIssue(){let[t,e,s,o,a]=await Promise.all([c({type:"QUERY_TASK",owner:this.owner,repo:this.repo,number:this.number}),c({type:"QUERY_STATUSES"}),c({type:"QUERY_ISSUE_LABELS",owner:this.owner,repo:this.repo,number:this.number}),c({type:"QUERY_PROPOSAL",owner:this.owner,repo:this.repo,number:this.number}),c({type:"GET_AUTOPOST"})]);t.ok?this.task=t.data??null:this.error=t.error??"Failed to load task",e.ok&&e.data&&(this.statuses=e.data),s.ok&&s.data&&(this.labels=s.data),o.ok&&(this.proposal=o.data??null,this.proposalDraftBody=this.proposal?.body??""),a.ok&&a.data&&(this.autoPostEnabled=a.data.enabled);let n=["queued","drafting","armed","posting"];this.proposal&&n.includes(this.proposal.state)&&this.startProposalPoll(),this.proposal?.state==="posted"&&this.proposal.github_comment_id&&this.verifyPostedComment()}async verifyPostedComment(){if(!this.proposal||this.proposal.state!=="posted")return;let t=this.proposal.id,e=await c({type:"VERIFY_POSTED_COMMENT",proposalId:t});if(!this.destroyed&&!(!e.ok||!e.data)&&e.data.state!==this.proposal?.state){let s=e.data.state==="draft";this.proposal=e.data,this.proposalDraftBody=e.data.body??"",s&&(this.proposalNotice="Previous comment was deleted on GitHub \u2014 reverted to draft.",setTimeout(()=>{this.destroyed||(this.proposalNotice=null,this.render())},8e3)),this.render()}}async initPr(){if(this.linkedIssueNumbers.length===0){this.error="No linked issues found";return}let[t,e]=await Promise.all([c({type:"QUERY_TASKS_BATCH",owner:this.owner,repo:this.repo,issueNumbers:this.linkedIssueNumbers}),c({type:"QUERY_STATUSES"})]);t.ok?this.linkedTasks=t.data??[]:this.error=t.error??"Failed to load tasks",e.ok&&e.data&&(this.statuses=e.data)}render(){this.mode==="pr"?this.renderPr():this.renderSidebar()}renderPr(){let t=$();if(this.root.innerHTML="",this.root.className=`tasker-header ${t?"dark":"light"}`,this.loading){this.root.innerHTML='<button class="tasker-btn" disabled><div class="spinner"></div> Tasker</button>';return}if(this.error){this.root.innerHTML="";return}this.linkedTasks.length!==0&&this.renderPrStatusBadge()}renderPrStatusBadge(){let e=new Set(this.linkedTasks.map(d=>d.status)).size>1,s,o,a;if(e)o=C.purple,a="Mixed";else{let d=this.linkedTasks[0].status;s=this.statuses.find(p=>p.key===d),o=S(s?s.color:"gray"),a=s?.label??d}let n=document.createElement("div");n.className="tasker-wrapper";let l=document.createElement("button");l.className="tasker-btn has-status",l.innerHTML=`
      <span class="tasker-icon">T</span>
      <span class="dot" style="background:${o}"></span>
      <span class="status-label">${this.escapeHtml(a)}</span>
      <span class="linked-count">${this.linkedTasks.length} issue${this.linkedTasks.length>1?"s":""}</span>
      <span class="chevron">${this.dropdownOpen?"&#9650;":"&#9660;"}</span>
    `,l.addEventListener("click",d=>{d.stopPropagation(),this.dropdownOpen=!this.dropdownOpen,this.render()}),n.appendChild(l),this.root.appendChild(n),this.dropdownOpen&&this.root.appendChild(this.renderPrDropdown())}renderPrDropdown(){let t=document.createElement("div");t.className="dropdown";let e=document.createElement("div");e.className="linked-notice",e.innerHTML=`Updating <strong>${this.linkedTasks.length}</strong> tracked issue${this.linkedTasks.length>1?"s":""}: ${this.linkedTasks.map(o=>`#${o.issue_number}`).join(", ")}`,t.appendChild(e);let s=this.groupStatuses();for(let o of R){let a=s[o];if(!a||a.length===0)continue;let n=document.createElement("div");n.className="group-label",n.textContent=N[o],t.appendChild(n);for(let l of a){let d=this.linkedTasks.every(u=>u.status===l.key),p=document.createElement("button");p.className=`status-row ${d?"active":""}`,p.innerHTML=`
          <span class="dot" style="background:${S(l.color)}"></span>
          <span class="label">${this.escapeHtml(l.label)}</span>
        `,p.addEventListener("click",async u=>{u.stopPropagation(),await this.updateLinkedStatuses(l.key,l.group_name)}),t.appendChild(p)}}return t}async updateLinkedStatuses(t,e){let s=this.linkedTasks.map(n=>({status:n.status,group:n.status_group}));for(let n of this.linkedTasks)n.status=t,n.status_group=e;this.dropdownOpen=!1,this.render();let o=this.linkedTasks.map(n=>n.issue_number).filter(n=>n!==null),a=await c({type:"UPDATE_LINKED_STATUSES",owner:this.owner,repo:this.repo,issueNumbers:o,status:t,statusGroup:e});a.ok||(this.linkedTasks.forEach((n,l)=>{n.status=s[l].status,n.status_group=s[l].group}),this.error=a.error??"Update failed",this.render(),setTimeout(()=>{this.error=null,this.render()},3e3))}renderSidebar(){let t=$();if(this.root.innerHTML="",this.root.className=`tasker-root ${t?"dark":"light"}`,this.loading){this.root.innerHTML='<div class="section"><div class="header">Tasker</div><div class="spinner-wrap"><div class="spinner"></div></div></div>';return}if(this.error){this.root.innerHTML=`
        <div class="section">
          <div class="header">Tasker</div>
          <div class="error-msg">${this.escapeHtml(this.error)}</div>
          <button class="retry-btn">Retry</button>
        </div>`,this.root.querySelector(".retry-btn")?.addEventListener("click",()=>this.init());return}if(!this.task){this.renderAddButton();return}this.renderStatusBadge()}renderAddButton(){let t=document.createElement("div");t.className="section",t.innerHTML='<div class="header">Tasker</div>';let e=document.createElement("button");e.className="add-btn",e.textContent="Add to Tasker",e.addEventListener("click",async()=>{e.disabled=!0,e.textContent="Adding...";let s=await c({type:"CREATE_TASK",owner:this.owner,repo:this.repo,number:this.number});s.ok&&s.data?(this.task=s.data,this.render()):(e.textContent=s.error??"Failed",setTimeout(()=>{e.disabled=!1,e.textContent="Add to Tasker"},2e3))}),t.appendChild(e),this.root.appendChild(t),this.renderProposalPanel()}renderStatusBadge(){let t=this.task,e=this.statuses.find(l=>l.key===t.status),s=S(e?e.color:"gray"),o=e?.label??t.status,a=document.createElement("div");a.className="section",a.innerHTML='<div class="header">Tasker</div>';let n=document.createElement("button");n.className="status-badge",n.innerHTML=`
      <span class="dot" style="background:${s}"></span>
      <span class="label">${this.escapeHtml(o)}</span>
      <span class="chevron">${this.dropdownOpen?"&#9650;":"&#9660;"}</span>
    `,n.addEventListener("click",l=>{l.stopPropagation(),this.dropdownOpen=!this.dropdownOpen,this.render()}),a.appendChild(n),this.dropdownOpen&&a.appendChild(this.renderDropdown()),this.root.appendChild(a),this.renderProposalPanel()}renderDropdown(){let t=document.createElement("div");t.className="dropdown";let e=this.groupStatuses();for(let s of R){let o=e[s];if(!o||o.length===0)continue;let a=document.createElement("div");a.className="group-label",a.textContent=N[s],t.appendChild(a);for(let n of o){let l=document.createElement("button");l.className=`status-row ${this.task?.status===n.key?"active":""}`,l.innerHTML=`
          <span class="dot" style="background:${S(n.color)}"></span>
          <span class="label">${this.escapeHtml(n.label)}</span>
        `,l.addEventListener("click",async d=>{d.stopPropagation(),await this.updateStatus(n.key,n.group_name)}),t.appendChild(l)}}return t}async updateStatus(t,e){if(!this.task)return;let s=this.task.status,o=this.task.status_group;this.task.status=t,this.task.status_group=e,this.dropdownOpen=!1,this.render();let a=await c({type:"UPDATE_STATUS",taskId:this.task.id,status:t,statusGroup:e});a.ok||(this.task.status=s,this.task.status_group=o,this.error=a.error??"Update failed",this.render(),setTimeout(()=>{this.error=null,this.render()},3e3))}hasReadyLabel(){return this.labels.some(t=>t.toLowerCase()===X)}hasRequiredDraftLabels(){let t=this.labels.map(e=>e.toLowerCase());return V.every(e=>t.includes(e))}isProposalPanelEligible(){return this.mode==="issue"}renderProposalPanel(){if(!this.isProposalPanelEligible())return;let t=document.createElement("div");t.className="section proposal",t.innerHTML='<div class="header">Proposal</div>';let e=document.createElement("div");e.className="proposal-body";let s=this.proposal?.state??"draft",o=s==="armed"||s==="posting",a=s==="posted",n=s==="failed";if(s==="queued"||s==="drafting"){let i=s==="queued"?"Queued for auto-drafting\u2026":"Auto-drafting proposal\u2026";e.innerHTML=`
        <div class="proposal-status">
          <span class="check">\u{1F916}</span>
          <div>
            <div class="proposal-status-line">${this.escapeHtml(i)}</div>
            <div class="proposal-status-sub">A proposal is being written and will arm automatically.</div>
          </div>
        </div>
      `,t.appendChild(e),this.root.appendChild(t);return}if(a){let i=this.proposal?.posted_at?new Date(this.proposal.posted_at).toLocaleString():"";e.innerHTML=`
        <div class="proposal-status posted">
          <span class="check">\u2713</span>
          <div>
            <div class="proposal-status-line">Posted ${this.escapeHtml(i)}</div>
            ${this.proposal?.github_comment_id?`<a class="comment-link" href="https://github.com/${this.escapeHtml(this.owner)}/${this.escapeHtml(this.repo)}/issues/${this.number}#issuecomment-${this.proposal.github_comment_id}" target="_blank" rel="noopener">View comment \u2192</a>`:""}
          </div>
        </div>
      `,t.appendChild(e),this.root.appendChild(t);return}if(this.proposalNotice){let i=document.createElement("div");i.className="proposal-notice",i.textContent=this.proposalNotice,e.appendChild(i)}if((s==="armed"||s==="posting")&&!this.autoPostEnabled){let i=document.createElement("div");i.className="proposal-notice danger",i.textContent="Auto-post is OFF in the Tasker popup \u2014 armed drafts are paused. Re-enable to post.",e.appendChild(i)}let p=this.hasReadyLabel(),u=this.hasRequiredDraftLabels();if(p){let i=document.createElement("div");i.className="proposal-notice",i.textContent='"Help Wanted" is already on this issue. Use \u201CPost now\u201D for an immediate manual post.',e.appendChild(i)}else if(!u){let i=document.createElement("div");i.className="proposal-notice subtle",i.textContent=this.labels.length?"Labels: "+this.labels.join(", ")+'. Will arm-and-wait for "Help Wanted".':'Labels not loaded. Will arm-and-wait for "Help Wanted" once added.',e.appendChild(i)}let h=document.createElement("textarea");h.className="proposal-textarea",h.rows=6,h.placeholder=`## Proposal

Describe your fix...`,h.value=this.proposalDraftBody,h.disabled=o||this.proposalBusy,e.appendChild(h);let m=document.createElement("div");m.className="proposal-actions";let v=()=>this.proposalDraftBody!==(this.proposal?.body??"")&&this.proposalDraftBody.trim().length>0,g=document.createElement("button");g.className="proposal-btn secondary",g.textContent=this.proposalBusy?"Saving\u2026":this.proposal?"Save changes":"Save draft",g.disabled=this.proposalBusy||o||!v(),g.addEventListener("click",()=>void this.saveProposal()),m.appendChild(g);let k=null;if(o){let i=document.createElement("button");i.className="proposal-btn",i.textContent=s==="posting"?"Posting\u2026":"Disarm",i.disabled=this.proposalBusy||s==="posting",i.addEventListener("click",()=>void this.setProposalState("draft")),m.appendChild(i)}else{let i=document.createElement("button");i.className="proposal-btn primary",i.textContent=this.proposalBusy?"Arming\u2026":"Arm auto-post";let f=v();i.disabled=this.proposalBusy||!this.proposalDraftBody.trim()||f,i.title=f?"Save changes before arming":"",i.addEventListener("click",()=>void this.setProposalState("armed")),m.appendChild(i),k=i}e.appendChild(m);let x=null;if(s!=="posting"){let i=document.createElement("div");i.className="proposal-actions";let f=document.createElement("button");f.className="proposal-btn danger",f.textContent=this.proposalBusy?"Posting\u2026":"Post now";let O=this.proposalDraftBody.trim().length>0;f.disabled=this.proposalBusy||!O,f.title=O?"Post the current text as a comment immediately, without waiting for Help Wanted.":"Type your proposal first.",f.addEventListener("click",()=>void this.postProposalNow()),i.appendChild(f),e.appendChild(i),x=f}h.addEventListener("input",()=>{this.proposalDraftBody=h.value;let i=v(),f=this.proposalDraftBody.trim().length>0;g.disabled=this.proposalBusy||o||!i,k&&(k.disabled=this.proposalBusy||!f||i,k.title=i?"Save changes before arming":""),x&&(x.disabled=this.proposalBusy||!f,x.title=f?"Post the current text as a comment immediately, without waiting for Help Wanted.":"Type your proposal first.")});let E=document.createElement("div");if(E.className="proposal-status-line",o)E.textContent=s==="posting"?"Posting now\u2026":'Armed \u2014 waiting for "Help Wanted" label';else if(this.proposal){let i=this.proposal.updated_at?new Date(this.proposal.updated_at).toLocaleString():"";E.textContent=`Draft saved \xB7 ${i}`}else E.textContent='Auto-posts on "Help Wanted" via the poll worker.';if(e.appendChild(E),n&&this.proposal?.last_error){let i=document.createElement("div");i.className="proposal-error",i.textContent=`Last error: ${this.proposal.last_error}`,e.appendChild(i)}t.appendChild(e),this.root.appendChild(t)}async saveProposal(){if(this.proposalBusy)return;this.proposalBusy=!0,this.render();let t=await c({type:"SAVE_PROPOSAL",owner:this.owner,repo:this.repo,number:this.number,body:this.proposalDraftBody});this.proposalBusy=!1,t.ok&&t.data?(this.proposal=t.data,this.proposalDraftBody=t.data.body):(this.error=t.error??"Save failed",setTimeout(()=>{this.error=null,this.render()},3e3)),this.render()}async setProposalState(t){if(this.proposalBusy)return;this.proposalBusy=!0,this.render();let e=await c({type:t==="armed"?"ARM_PROPOSAL":"DISARM_PROPOSAL",owner:this.owner,repo:this.repo,number:this.number});this.proposalBusy=!1,e.ok&&e.data?(this.proposal=e.data,e.data.state==="armed"||e.data.state==="posting"?this.startProposalPoll():this.stopProposalPoll()):(this.error=e.error??"Update failed",setTimeout(()=>{this.error=null,this.render()},3e3)),this.render()}async postProposalNow(){if(!(this.proposalBusy||!this.proposalDraftBody.trim())&&confirm("Post this proposal as a comment now?")){this.proposalBusy=!0,this.render();try{let e=await c({type:"SAVE_PROPOSAL",owner:this.owner,repo:this.repo,number:this.number,body:this.proposalDraftBody});if(!e.ok||!e.data){this.error=e.error??"Save failed",setTimeout(()=>{this.error=null,this.render()},3e3);return}this.proposal=e.data,this.proposal={...this.proposal,state:"posting"},this.startProposalPoll(),this.render();let s=await c({type:"POST_PROPOSAL_NOW",proposalId:e.data.id,force:!0});s.ok&&s.data?(this.proposal=s.data,(s.data.state==="posted"||s.data.state==="failed")&&this.stopProposalPoll()):(this.error=s.error??"Post failed",setTimeout(()=>{this.error=null,this.render()},5e3),this.refreshProposal())}catch(e){console.error("[tasker] postProposalNow threw",e),this.error=e instanceof Error?e.message:"Post failed (channel closed)",setTimeout(()=>{this.error=null,this.render()},5e3)}finally{this.proposalBusy=!1,this.render()}}}startProposalPoll(){this.stopProposalPoll(),this.proposalPollHandle=setInterval(()=>{this.refreshProposal()},K)}stopProposalPoll(){this.proposalPollHandle!==null&&(clearInterval(this.proposalPollHandle),this.proposalPollHandle=null)}async refreshProposal(){if(this.destroyed)return;let t=await c({type:"QUERY_PROPOSAL",owner:this.owner,repo:this.repo,number:this.number});if(this.destroyed||!t.ok||!t.data)return;let e=t.data;(!this.proposal||e.state!==this.proposal.state||e.posted_at!==this.proposal.posted_at)&&(this.proposal=e,(e.state==="posted"||e.state==="failed"||e.state==="draft")&&this.stopProposalPoll(),this.render())}groupStatuses(){let t={todo:[],in_progress:[],complete:[]};for(let e of this.statuses)t[e.group_name]?.push(e);for(let e of R)t[e].sort((s,o)=>s.position-o.position);return t}escapeHtml(t){let e=document.createElement("span");return e.textContent=t,e.innerHTML}destroy(){this.destroyed=!0,this.stopProposalPoll(),this.container.remove()}getHeaderStyles(){return`
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

      .section.proposal { margin-top: 8px; }

      .proposal-textarea {
        width: 100%;
        box-sizing: border-box;
        padding: 6px 8px;
        border-radius: 6px;
        font: inherit;
        font-size: 12px;
        line-height: 1.4;
        resize: vertical;
        min-height: 80px;
        margin-bottom: 8px;
      }
      .tasker-root.light .proposal-textarea {
        background: #ffffff;
        color: #1f2328;
        border: 1px solid #d1d9e0;
      }
      .tasker-root.dark .proposal-textarea {
        background: #0d1117;
        color: #e6edf3;
        border: 1px solid #3d444d;
      }
      .proposal-textarea:disabled { opacity: 0.7; cursor: not-allowed; }

      .proposal-actions {
        display: flex;
        gap: 6px;
        margin-bottom: 6px;
      }
      .proposal-btn {
        flex: 1;
        padding: 5px 10px;
        font-size: 12px;
        border-radius: 6px;
        cursor: pointer;
        border: 1px solid transparent;
        font-weight: 500;
      }
      .proposal-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .tasker-root.light .proposal-btn {
        background: #f6f8fa;
        color: #1f2328;
        border-color: #d1d9e0;
      }
      .tasker-root.light .proposal-btn:hover:not(:disabled) {
        background: #eaeef2;
      }
      .tasker-root.dark .proposal-btn {
        background: #21262d;
        color: #e6edf3;
        border-color: #3d444d;
      }
      .tasker-root.dark .proposal-btn:hover:not(:disabled) {
        background: #292e36;
      }
      .proposal-btn.primary {
        background: #2563eb;
        color: #ffffff;
        border-color: #2563eb;
      }
      .proposal-btn.primary:hover:not(:disabled) { background: #1d4ed8; }

      .proposal-btn.danger {
        background: #dc2626;
        color: #ffffff;
        border-color: #dc2626;
      }
      .proposal-btn.danger:hover:not(:disabled) { background: #b91c1c; }

      .proposal-status-line {
        font-size: 11px;
        opacity: 0.7;
      }
      .proposal-status-sub {
        font-size: 10px;
        opacity: 0.5;
        margin-top: 2px;
      }

      .proposal-notice {
        font-size: 11px;
        padding: 5px 8px;
        border-radius: 4px;
        margin-bottom: 6px;
      }
      .tasker-root.light .proposal-notice {
        background: #fff8c5;
        color: #633c01;
        border: 1px solid #d4a72c;
      }
      .tasker-root.dark .proposal-notice {
        background: #3a2e00;
        color: #f2cc60;
        border: 1px solid #6e4f00;
      }
      .proposal-notice.subtle {
        opacity: 0.85;
      }
      .tasker-root.light .proposal-notice.danger {
        background: #ffebe9;
        color: #82071e;
        border: 1px solid #ff8182;
      }
      .tasker-root.dark .proposal-notice.danger {
        background: #5a1a1a;
        color: #ffa198;
        border: 1px solid #f85149;
      }
      .tasker-root.light .proposal-notice.subtle {
        background: #f6f8fa;
        color: #57606a;
        border: 1px solid #d1d9e0;
      }
      .tasker-root.dark .proposal-notice.subtle {
        background: #21262d;
        color: #8b949e;
        border: 1px solid #3d444d;
      }

      .proposal-status.posted {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        font-size: 12px;
      }
      .proposal-status.posted .check {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: #1a7f37;
        color: #fff;
        font-size: 12px;
        flex-shrink: 0;
      }
      .proposal-status.posted .comment-link {
        display: block;
        font-size: 11px;
        margin-top: 2px;
        color: inherit;
        opacity: 0.8;
      }

      .proposal-error {
        font-size: 11px;
        margin-top: 4px;
        color: #cf222e;
      }
      .tasker-root.dark .proposal-error { color: #f85149; }
    `}};var G="extensionSettings";var b={autoRefreshEnabled:!1,autoRefreshSeconds:20,notifyHelpWanted:!1,notifyChannels:["browser"],telegramChatId:"",pollSeconds:45,watchedLabelGroups:[["Help Wanted"],["Daily"],["Bug"]],excludedLabels:["DeployBlocker","DeployBlockerCash"],bugDailyPopupEnabled:!0,bugDailyPopupSound:!0},J=["browser","telegram"];function Z(r){if(!Array.isArray(r))return[...b.notifyChannels];let t=r.filter(e=>typeof e=="string"&&J.includes(e));return t.length>0?Array.from(new Set(t)):[...b.notifyChannels]}function D(r,t){if(!Array.isArray(r))return[...t];let e=r.filter(s=>typeof s=="string").map(s=>s.trim()).filter(s=>s.length>0&&s.length<=64);return Array.from(new Map(e.map(s=>[s.toLowerCase(),s])).values())}function ee(r){if(!Array.isArray(r))return null;let t=[];for(let e of r){if(!Array.isArray(e))continue;let s=D(e,[]);s.length>0&&t.push(s)}return t}async function H(){let t=(await chrome.storage.local.get(G))[G],e,s=ee(t?.watchedLabelGroups);return s!==null?e=s:t?.watchedLabels!==void 0?e=D(t.watchedLabels,[]).map(o=>[o]):e=b.watchedLabelGroups.map(o=>[...o]),{autoRefreshEnabled:t?.autoRefreshEnabled??b.autoRefreshEnabled,autoRefreshSeconds:Math.max(5,t?.autoRefreshSeconds??b.autoRefreshSeconds),notifyHelpWanted:t?.notifyHelpWanted??b.notifyHelpWanted,notifyChannels:Z(t?.notifyChannels),telegramChatId:t?.telegramChatId??b.telegramChatId,pollSeconds:Math.max(30,t?.pollSeconds??b.pollSeconds),watchedLabelGroups:e,excludedLabels:t?.excludedLabels===void 0?[...b.excludedLabels]:D(t.excludedLabels,[]),bugDailyPopupEnabled:t?.bugDailyPopupEnabled??b.bugDailyPopupEnabled,bugDailyPopupSound:t?.bugDailyPopupSound??b.bugDailyPopupSound}}function W(r,t,e="seenHelpWanted"){return`${e}:${r.toLowerCase()}/${t.toLowerCase()}`}async function M(r,t,e){let s=W(r,t,e),a=(await chrome.storage.local.get(s))[s]??[];return new Set(a)}async function B(r,t,e,s){let o=Array.from(e),a=o.length>500?o.slice(o.length-500):o;await chrome.storage.local.set({[W(r,t,s)]:a})}var q="tasker-issue-alert";var w=null;function te(){try{let r=window.AudioContext||window.webkitAudioContext;if(!r)return;w=w??new r,w.state==="suspended"&&w.resume();let t=w.currentTime;for(let[e,s]of[880,1320].entries()){let o=w.createOscillator(),a=w.createGain();o.type="sine",o.frequency.value=s;let n=t+e*.12;a.gain.setValueAtTime(1e-4,n),a.gain.exponentialRampToValueAtTime(.07,n+.02),a.gain.exponentialRampToValueAtTime(1e-4,n+.18),o.connect(a),a.connect(w.destination),o.start(n),o.stop(n+.2)}}catch{}}var se=`
  .stack {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 380px;
    max-width: calc(100vw - 24px);
    pointer-events: none;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  }
  .card {
    pointer-events: auto;
    position: relative;
    overflow: hidden;
    background: #0d1117;
    color: #e6edf3;
    border: 1px solid rgba(245, 166, 35, 0.5);
    border-radius: 12px;
    padding: 14px 14px 16px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.55);
    cursor: pointer;
    animation: tk-slidein 0.32s cubic-bezier(0.16, 1, 0.3, 1), tk-glow 1.4s ease-in-out infinite;
  }
  .card:hover { border-color: rgba(245, 166, 35, 0.9); }
  .card.out { animation: tk-slideout 0.26s ease forwards; }
  .flash {
    position: absolute; inset: 0;
    background: radial-gradient(circle at 50% 100%, rgba(255, 211, 61, 0.5), transparent 70%);
    animation: tk-flash 0.6s ease-out 1 forwards;
    pointer-events: none;
  }
  .hd { display: flex; align-items: center; gap: 8px; }
  .bolt { font-size: 18px; animation: tk-bolt 1s steps(1) infinite; }
  .badge {
    font-size: 11px; font-weight: 800; letter-spacing: 0.08em;
    color: #1c1500; background: linear-gradient(90deg, #ffd33d, #f5a623);
    padding: 2px 8px; border-radius: 999px;
  }
  .x {
    margin-left: auto; background: transparent; border: 0; color: #8b949e;
    font-size: 20px; line-height: 1; cursor: pointer; padding: 0 2px;
  }
  .x:hover { color: #e6edf3; }
  .title {
    display: block; margin: 10px 0 8px; color: #e6edf3; text-decoration: none;
    font-size: 14px; font-weight: 600; line-height: 1.35;
  }
  .card:hover .title { color: #ffd33d; text-decoration: underline; }
  .chips { display: flex; gap: 6px; }
  .chip {
    font-size: 11px; font-weight: 600; padding: 1px 8px; border-radius: 999px;
    border: 1px solid transparent;
  }
  .chip.bug { color: #ffb4a8; background: rgba(248, 81, 73, 0.16); border-color: rgba(248, 81, 73, 0.4); }
  .chip.daily { color: #ffd9a8; background: rgba(245, 166, 35, 0.16); border-color: rgba(245, 166, 35, 0.4); }
  .chip.help { color: #aef0c2; background: rgba(63, 185, 80, 0.16); border-color: rgba(63, 185, 80, 0.4); }
  .chip.external { color: #a8d4ff; background: rgba(47, 129, 247, 0.16); border-color: rgba(47, 129, 247, 0.4); }
  .chip.generic { color: #c9d1d9; background: rgba(139, 148, 158, 0.16); border-color: rgba(139, 148, 158, 0.4); }
  .hint { margin-top: 9px; font-size: 12px; color: #8b949e; }
  .bar {
    position: absolute; left: 0; bottom: 0; height: 3px; width: 100%;
    background: linear-gradient(90deg, #ffd33d, #f5a623);
    transform-origin: left; animation: tk-count linear forwards;
  }
  @keyframes tk-slidein { from { opacity: 0; transform: translateY(16px) scale(0.98); } to { opacity: 1; transform: none; } }
  @keyframes tk-slideout { to { opacity: 0; transform: translateY(10px); } }
  @keyframes tk-glow {
    0%, 100% { box-shadow: 0 8px 28px rgba(0,0,0,0.55), 0 0 0 0 rgba(245,166,35,0.0); }
    50% { box-shadow: 0 8px 28px rgba(0,0,0,0.55), 0 0 18px 2px rgba(245,166,35,0.45); }
  }
  @keyframes tk-flash { from { opacity: 1; } to { opacity: 0; } }
  @keyframes tk-bolt { 0%, 92%, 100% { opacity: 1; } 95% { opacity: 0.25; } }
  @keyframes tk-count { from { transform: scaleX(1); } to { transform: scaleX(0); } }
  @media (prefers-reduced-motion: reduce) {
    .card, .flash, .bolt { animation: tk-slidein 0.2s ease both; }
    .bar { animation: tk-count linear forwards; }
  }
`;function oe(){let r=document.getElementById(q);if(r&&r.shadowRoot){let o=r.shadowRoot.querySelector(".stack");return{host:r,stack:o}}r=document.createElement("div"),r.id=q,Object.assign(r.style,{position:"fixed",top:"0",left:"0",width:"0",height:"0",zIndex:"2147483647"}),document.body.appendChild(r);let t=r.attachShadow({mode:"open"}),e=document.createElement("style");e.textContent=se;let s=document.createElement("div");return s.className="stack",t.append(e,s),{host:r,stack:s}}function re(r){let t=new Map;for(let e of r)for(let s of e.split("+")){let o=s.trim();o&&t.set(o.toLowerCase(),o)}return t.size>0?Array.from(t.values()):["New"]}function ae(r){let t=r.toLowerCase();return t.includes("bug")?"chip bug":t.includes("daily")?"chip daily":t.includes("help")?"chip help":t.includes("external")?"chip external":"chip generic"}function ne(r,t){let e=document.createElement("div");e.className="card";let s=document.createElement("div");s.className="flash";let o=document.createElement("div");o.className="hd";let a=document.createElement("span");a.className="bolt",a.textContent="\u26A1";let n=document.createElement("span");n.className="badge",n.textContent="NEW BOUNTY";let l=document.createElement("button");l.className="x",l.textContent="\xD7",l.title="Dismiss",o.append(a,n,l);let d=document.createElement("div");d.className="title",d.textContent=`#${r.number} \xB7 ${r.title}`;let p=document.createElement("div");p.className="chips";for(let k of re(r.labels)){let x=document.createElement("span");x.className=ae(k),x.textContent=k,p.append(x)}let u=document.createElement("div");u.className="hint",u.textContent="Open it and arm your proposal before someone grabs it.";let h=document.createElement("div");h.className="bar",h.style.animationDuration="15000ms",e.append(s,o,d,p,u,h);let m=null,v=!1,g=()=>{v||(v=!0,m&&clearTimeout(m),e.classList.add("out"),setTimeout(()=>{e.remove(),t()},280))};return e.addEventListener("click",()=>{window.open(r.url,"_blank","noopener"),g()}),l.addEventListener("click",k=>{k.stopPropagation(),g()}),e.addEventListener("mouseenter",()=>{m&&clearTimeout(m),h.style.animationPlayState="paused"}),e.addEventListener("mouseleave",()=>{v||(h.style.animationPlayState="running",m=setTimeout(g,15e3))}),m=setTimeout(g,15e3),e}function T(r,t={}){if(r.length===0)return;let{host:e,stack:s}=oe(),o=()=>{s.childElementCount===0&&e.remove()};for(let a of r.slice(0,5))s.appendChild(ne(a,o));t.sound!==!1&&te()}var Y="seenBugDailyPopup";function ie(r){return r.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}function j(r){let t=ie(r).replace(/\s+/g,"[\\s-]?");return new RegExp(`(?:^|[^a-z0-9])${t}(?:$|[^a-z0-9])`,"i")}function le(r,t){let e=[];for(let s of t){if(s.length===0)continue;s.every(a=>j(a).test(r))&&e.push(s.join(" + "))}return e}function de(r,t){for(let e of t)if(j(e).test(r))return!0;return!1}function F(r,t){let e=new Map;if(r.length===0)return[];let s=new Set;document.querySelectorAll('[data-testid="list-view-item"], [data-testid="list-view-items"] > li, div[id^="issue_"], li[id^="issue_"]').forEach(o=>s.add(o)),s.size===0&&document.querySelectorAll('a[href*="/issues/"]').forEach(o=>{let a=o.closest('li, article, div[role="listitem"]');a&&s.add(a)});for(let o of s){let a=o.textContent??"";if(de(a,t))continue;let n=le(a,r);if(n.length===0)continue;let l=o.querySelector('a[data-testid="issue-pr-title-link"], a[id^="issue_"][href*="/issues/"], a[href*="/issues/"]');if(!l)continue;let d=l.href,p=d.match(/\/issues\/(\d+)(?:[?#].*)?$/);if(!p)continue;let u=parseInt(p[1],10);if(!Number.isFinite(u)||u<=0||e.has(u))continue;let h=(l.textContent??"").trim()||`Issue #${u}`;e.set(u,{number:u,title:h,url:d,labels:n})}return Array.from(e.values())}var A=class{constructor(t,e){this.owner=t;this.repo=e}refreshTimer=null;scanTimer=null;destroyed=!1;async init(){let t=await H();if(window.location.hash==="#tasker-test-alert"&&T([{number:99999,title:"Test bounty \u2014 Bug + Daily lightning popup",url:window.location.href,labels:["Bug + Daily"]}],{sound:t.bugDailyPopupSound}),this.scanTimer=window.setTimeout(()=>{this.runScan(!0)},1500),t.autoRefreshEnabled){let e=Math.max(5,t.autoRefreshSeconds)*1e3;this.refreshTimer=window.setTimeout(()=>{this.destroyed||window.location.reload()},e)}}async runScan(t){if(!this.destroyed)try{let e=await H();await this.checkBugDailyPopup(e,t);let s=F(e.watchedLabelGroups,e.excludedLabels),o=await M(this.owner,this.repo),a=e.notifyHelpWanted,n=s.filter(d=>!o.has(d.number));if(n.length===0)return;let l=o.size===0&&t;for(let d of n)o.add(d.number);if(await B(this.owner,this.repo,o),l||!a)return;for(let d of n.slice(0,10)){let p={type:"SEND_HELP_WANTED",owner:this.owner,repo:this.repo,number:d.number,title:d.title,url:d.url,labels:d.labels};chrome.runtime.sendMessage(p).catch(()=>{})}}catch{}}async checkBugDailyPopup(t,e){if(this.destroyed||!t.bugDailyPopupEnabled)return;let s=F(t.watchedLabelGroups,t.excludedLabels);if(s.length===0)return;let o=await M(this.owner,this.repo,Y),a=s.filter(l=>!o.has(l.number));if(a.length===0)return;let n=o.size===0&&e;for(let l of a)o.add(l.number);await B(this.owner,this.repo,o,Y),!(n||this.destroyed)&&T(a,{sound:t.bugDailyPopupSound})}destroy(){this.destroyed=!0,this.refreshTimer!==null&&(clearTimeout(this.refreshTimer),this.refreshTimer=null),this.scanTimer!==null&&(clearTimeout(this.scanTimer),this.scanTimer=null)}};var y=null,L=null,_="";function pe(){return document.querySelector('[class*="sidebarContent"]')??document.querySelector(".Layout-sidebar .BorderGrid")??null}function ce(){return document.querySelector('[class*="PageHeader-Description"] .d-flex.flex-justify-between')??null}function ue(){let r=document.querySelector(".js-comment-body")??document.querySelector('[data-testid="issue-body"]');if(!r)return[];let t=new Set,e=r.querySelectorAll('a[href*="/issues/"]');for(let a of e){let l=a.href.match(/\/issues\/(\d+)/);l&&t.add(parseInt(l[1],10))}let o=(r.textContent??"").matchAll(/#(\d{2,})/g);for(let a of o)t.add(parseInt(a[1],10));return Array.from(t)}function I(){let r=window.location.href;if(r===_)return;_=r,y&&(y.destroy(),y=null),L&&(L.destroy(),L=null);let t=U(r);if(t){L=new A(t.owner,t.repo),L.init();return}let e=z(r);if(!e)return;let s=(o=0)=>{if(e.type==="pr"){let a=ce();if(!a){o<20&&setTimeout(()=>s(o+1),250);return}let n=ue();y=new P(e.owner,e.repo,e.number,"pr",n),a.appendChild(y.element),y.init()}else{let a=pe();if(!a){o<20&&setTimeout(()=>s(o+1),250);return}y=new P(e.owner,e.repo,e.number,"issue",[]),a.appendChild(y.element),y.init()}};s()}I();document.addEventListener("turbo:load",()=>{_="",I()});var Q=window.location.href;setInterval(()=>{window.location.href!==Q&&(Q=window.location.href,_="",I())},1e3);chrome.runtime.onMessage.addListener(r=>{r.type==="TEST_BUG_DAILY_ALERT"&&T([{number:99999,title:"Test bounty \u2014 Bug + Daily lightning popup",url:window.location.href,labels:["Bug + Daily"]}],{sound:r.sound})});})();
