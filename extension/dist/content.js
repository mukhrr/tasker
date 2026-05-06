"use strict";(()=>{function H(a){let e=a.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/?(?:\?.*)?(?:#.*)?$/);return e?{owner:e[1],repo:e[2]}:null}function M(a){let e=a.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);if(e)return{owner:e[1],repo:e[2],number:parseInt(e[3],10),type:"issue"};let t=a.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);return t?{owner:t[1],repo:t[2],number:parseInt(t[3],10),type:"pr"}:null}var P={gray:"#6b7280",yellow:"#eab308",green:"#22c55e",red:"#ef4444",blue:"#3b82f6",purple:"#a855f7",pink:"#ec4899",orange:"#f97316"},R={todo:"To-do",in_progress:"In Progress",complete:"Complete"},S=["todo","in_progress","complete"];var F=["bug","daily"],O="help wanted",G=2e3,W=1500,q=[".js-issue-labels",'[data-testid="issue-labels"]','[aria-label="Labels"]'];function c(a){return chrome.runtime.sendMessage(a)}function N(){return document.documentElement.getAttribute("data-color-mode")==="dark"||document.documentElement.getAttribute("data-dark-theme")==="dark"||document.documentElement.classList.contains("dark")}function b(a){return P[a]??P.gray}var y=class{container;shadow;root;task=null;linkedTasks=[];statuses=[];dropdownOpen=!1;loading=!0;error=null;owner;repo;number;mode;linkedIssueNumbers;labels=[];proposal=null;proposalDraftBody="";proposalBusy=!1;proposalPollHandle=null;destroyed=!1;autoPostEnabled=!0;fastPathHandle=null;fastPathObservers=[];fastPathEtag=null;fastPathTriggered=!1;fastPathVisibilityListener=null;constructor(e,t,s,r="issue",o=[]){this.owner=e,this.repo=t,this.number=s,this.mode=r,this.linkedIssueNumbers=o,this.container=document.createElement("div"),this.container.id="tasker-status-widget",r==="pr"&&(this.container.style.display="inline-flex",this.container.style.alignItems="center",this.container.style.flexShrink="0",this.container.style.alignSelf="start",this.container.style.position="relative"),this.shadow=this.container.attachShadow({mode:"closed"}),this.root=document.createElement("div"),this.shadow.appendChild(this.root);let n=document.createElement("style");n.textContent=this.mode==="pr"?this.getHeaderStyles():this.getSidebarStyles(),this.shadow.appendChild(n),document.addEventListener("click",l=>{!this.container.contains(l.target)&&this.dropdownOpen&&(this.dropdownOpen=!1,this.render())})}get element(){return this.container}async init(){this.loading=!0,this.error=null,this.render();try{let e=await c({type:"GET_SESSION"});if(!e.ok||!e.data){this.loading=!1,this.error="Not signed in to Tasker",this.render();return}this.mode==="pr"?await this.initPr():await this.initIssue()}catch(e){this.error=e.message??"Connection error"}this.loading=!1,this.render()}async initIssue(){let[e,t,s,r,o]=await Promise.all([c({type:"QUERY_TASK",owner:this.owner,repo:this.repo,number:this.number}),c({type:"QUERY_STATUSES"}),c({type:"QUERY_ISSUE_LABELS",owner:this.owner,repo:this.repo,number:this.number}),c({type:"QUERY_PROPOSAL",owner:this.owner,repo:this.repo,number:this.number}),c({type:"GET_AUTOPOST"})]);e.ok?this.task=e.data??null:this.error=e.error??"Failed to load task",t.ok&&t.data&&(this.statuses=t.data),s.ok&&s.data&&(this.labels=s.data),r.ok&&(this.proposal=r.data??null,this.proposalDraftBody=this.proposal?.body??""),o.ok&&o.data&&(this.autoPostEnabled=o.data.enabled),(this.proposal?.state==="armed"||this.proposal?.state==="posting")&&(this.startProposalPoll(),this.startFastPath())}async initPr(){if(this.linkedIssueNumbers.length===0){this.error="No linked issues found";return}let[e,t]=await Promise.all([c({type:"QUERY_TASKS_BATCH",owner:this.owner,repo:this.repo,issueNumbers:this.linkedIssueNumbers}),c({type:"QUERY_STATUSES"})]);e.ok?this.linkedTasks=e.data??[]:this.error=e.error??"Failed to load tasks",t.ok&&t.data&&(this.statuses=t.data)}render(){this.mode==="pr"?this.renderPr():this.renderSidebar()}renderPr(){let e=N();if(this.root.innerHTML="",this.root.className=`tasker-header ${e?"dark":"light"}`,this.loading){this.root.innerHTML='<button class="tasker-btn" disabled><div class="spinner"></div> Tasker</button>';return}if(this.error){this.root.innerHTML="";return}this.linkedTasks.length!==0&&this.renderPrStatusBadge()}renderPrStatusBadge(){let t=new Set(this.linkedTasks.map(d=>d.status)).size>1,s,r,o;if(t)r=P.purple,o="Mixed";else{let d=this.linkedTasks[0].status;s=this.statuses.find(u=>u.key===d),r=b(s?s.color:"gray"),o=s?.label??d}let n=document.createElement("div");n.className="tasker-wrapper";let l=document.createElement("button");l.className="tasker-btn has-status",l.innerHTML=`
      <span class="tasker-icon">T</span>
      <span class="dot" style="background:${r}"></span>
      <span class="status-label">${this.escapeHtml(o)}</span>
      <span class="linked-count">${this.linkedTasks.length} issue${this.linkedTasks.length>1?"s":""}</span>
      <span class="chevron">${this.dropdownOpen?"&#9650;":"&#9660;"}</span>
    `,l.addEventListener("click",d=>{d.stopPropagation(),this.dropdownOpen=!this.dropdownOpen,this.render()}),n.appendChild(l),this.root.appendChild(n),this.dropdownOpen&&this.root.appendChild(this.renderPrDropdown())}renderPrDropdown(){let e=document.createElement("div");e.className="dropdown";let t=document.createElement("div");t.className="linked-notice",t.innerHTML=`Updating <strong>${this.linkedTasks.length}</strong> tracked issue${this.linkedTasks.length>1?"s":""}: ${this.linkedTasks.map(r=>`#${r.issue_number}`).join(", ")}`,e.appendChild(t);let s=this.groupStatuses();for(let r of S){let o=s[r];if(!o||o.length===0)continue;let n=document.createElement("div");n.className="group-label",n.textContent=R[r],e.appendChild(n);for(let l of o){let d=this.linkedTasks.every(p=>p.status===l.key),u=document.createElement("button");u.className=`status-row ${d?"active":""}`,u.innerHTML=`
          <span class="dot" style="background:${b(l.color)}"></span>
          <span class="label">${this.escapeHtml(l.label)}</span>
        `,u.addEventListener("click",async p=>{p.stopPropagation(),await this.updateLinkedStatuses(l.key,l.group_name)}),e.appendChild(u)}}return e}async updateLinkedStatuses(e,t){let s=this.linkedTasks.map(n=>({status:n.status,group:n.status_group}));for(let n of this.linkedTasks)n.status=e,n.status_group=t;this.dropdownOpen=!1,this.render();let r=this.linkedTasks.map(n=>n.issue_number).filter(n=>n!==null),o=await c({type:"UPDATE_LINKED_STATUSES",owner:this.owner,repo:this.repo,issueNumbers:r,status:e,statusGroup:t});o.ok||(this.linkedTasks.forEach((n,l)=>{n.status=s[l].status,n.status_group=s[l].group}),this.error=o.error??"Update failed",this.render(),setTimeout(()=>{this.error=null,this.render()},3e3))}renderSidebar(){let e=N();if(this.root.innerHTML="",this.root.className=`tasker-root ${e?"dark":"light"}`,this.loading){this.root.innerHTML='<div class="section"><div class="header">Tasker</div><div class="spinner-wrap"><div class="spinner"></div></div></div>';return}if(this.error){this.root.innerHTML=`
        <div class="section">
          <div class="header">Tasker</div>
          <div class="error-msg">${this.escapeHtml(this.error)}</div>
          <button class="retry-btn">Retry</button>
        </div>`,this.root.querySelector(".retry-btn")?.addEventListener("click",()=>this.init());return}if(!this.task){this.renderAddButton();return}this.renderStatusBadge()}renderAddButton(){let e=document.createElement("div");e.className="section",e.innerHTML='<div class="header">Tasker</div>';let t=document.createElement("button");t.className="add-btn",t.textContent="Add to Tasker",t.addEventListener("click",async()=>{t.disabled=!0,t.textContent="Adding...";let s=await c({type:"CREATE_TASK",owner:this.owner,repo:this.repo,number:this.number});s.ok&&s.data?(this.task=s.data,this.render()):(t.textContent=s.error??"Failed",setTimeout(()=>{t.disabled=!1,t.textContent="Add to Tasker"},2e3))}),e.appendChild(t),this.root.appendChild(e),this.renderProposalPanel()}renderStatusBadge(){let e=this.task,t=this.statuses.find(l=>l.key===e.status),s=b(t?t.color:"gray"),r=t?.label??e.status,o=document.createElement("div");o.className="section",o.innerHTML='<div class="header">Tasker</div>';let n=document.createElement("button");n.className="status-badge",n.innerHTML=`
      <span class="dot" style="background:${s}"></span>
      <span class="label">${this.escapeHtml(r)}</span>
      <span class="chevron">${this.dropdownOpen?"&#9650;":"&#9660;"}</span>
    `,n.addEventListener("click",l=>{l.stopPropagation(),this.dropdownOpen=!this.dropdownOpen,this.render()}),o.appendChild(n),this.dropdownOpen&&o.appendChild(this.renderDropdown()),this.root.appendChild(o),this.renderProposalPanel()}renderDropdown(){let e=document.createElement("div");e.className="dropdown";let t=this.groupStatuses();for(let s of S){let r=t[s];if(!r||r.length===0)continue;let o=document.createElement("div");o.className="group-label",o.textContent=R[s],e.appendChild(o);for(let n of r){let l=document.createElement("button");l.className=`status-row ${this.task?.status===n.key?"active":""}`,l.innerHTML=`
          <span class="dot" style="background:${b(n.color)}"></span>
          <span class="label">${this.escapeHtml(n.label)}</span>
        `,l.addEventListener("click",async d=>{d.stopPropagation(),await this.updateStatus(n.key,n.group_name)}),e.appendChild(l)}}return e}async updateStatus(e,t){if(!this.task)return;let s=this.task.status,r=this.task.status_group;this.task.status=e,this.task.status_group=t,this.dropdownOpen=!1,this.render();let o=await c({type:"UPDATE_STATUS",taskId:this.task.id,status:e,statusGroup:t});o.ok||(this.task.status=s,this.task.status_group=r,this.error=o.error??"Update failed",this.render(),setTimeout(()=>{this.error=null,this.render()},3e3))}hasReadyLabel(){return this.labels.some(e=>e.toLowerCase()===O)}hasRequiredDraftLabels(){let e=this.labels.map(t=>t.toLowerCase());return F.every(t=>e.includes(t))}isProposalPanelEligible(){return this.mode==="issue"}renderProposalPanel(){if(!this.isProposalPanelEligible())return;let e=document.createElement("div");e.className="section proposal",e.innerHTML='<div class="header">Proposal</div>';let t=document.createElement("div");t.className="proposal-body";let s=this.proposal?.state??"draft",r=s==="armed"||s==="posting",o=s==="posted",n=s==="failed";if(o){let i=this.proposal?.posted_at?new Date(this.proposal.posted_at).toLocaleString():"";t.innerHTML=`
        <div class="proposal-status posted">
          <span class="check">\u2713</span>
          <div>
            <div class="proposal-status-line">Posted ${this.escapeHtml(i)}</div>
            ${this.proposal?.github_comment_id?`<a class="comment-link" href="https://github.com/${this.escapeHtml(this.owner)}/${this.escapeHtml(this.repo)}/issues/${this.number}#issuecomment-${this.proposal.github_comment_id}" target="_blank" rel="noopener">View comment \u2192</a>`:""}
          </div>
        </div>
      `,e.appendChild(t),this.root.appendChild(e);return}if((s==="armed"||s==="posting")&&!this.autoPostEnabled){let i=document.createElement("div");i.className="proposal-notice danger",i.textContent="Auto-post is OFF in the Tasker popup \u2014 armed drafts are paused. Re-enable to post.",t.appendChild(i)}let d=this.hasReadyLabel(),u=this.hasRequiredDraftLabels();if(d){let i=document.createElement("div");i.className="proposal-notice",i.textContent=s==="armed"?'"Help Wanted" already added \u2014 posting on next poll cycle.':'"Help Wanted" is already on this issue. Arm to post immediately.',t.appendChild(i)}else if(!u){let i=document.createElement("div");i.className="proposal-notice subtle",i.textContent=this.labels.length?"Labels: "+this.labels.join(", ")+'. Will arm-and-wait for "Help Wanted".':'Labels not loaded. Will arm-and-wait for "Help Wanted" once added.',t.appendChild(i)}let p=document.createElement("textarea");p.className="proposal-textarea",p.rows=6,p.placeholder=`## Proposal

Describe your fix...`,p.value=this.proposalDraftBody,p.disabled=r||this.proposalBusy,t.appendChild(p);let m=document.createElement("div");m.className="proposal-actions";let T=()=>this.proposalDraftBody!==(this.proposal?.body??"")&&this.proposalDraftBody.trim().length>0,g=document.createElement("button");g.className="proposal-btn secondary",g.textContent=this.proposalBusy?"Saving\u2026":this.proposal?"Save changes":"Save draft",g.disabled=this.proposalBusy||r||!T(),g.addEventListener("click",()=>void this.saveProposal()),m.appendChild(g);let v=null;if(r){let i=document.createElement("button");i.className="proposal-btn",i.textContent=s==="posting"?"Posting\u2026":"Disarm",i.disabled=this.proposalBusy||s==="posting",i.addEventListener("click",()=>void this.setProposalState("draft")),m.appendChild(i)}else{let i=document.createElement("button");i.className="proposal-btn primary",i.textContent=this.proposalBusy?"Arming\u2026":"Arm auto-post";let w=T();i.disabled=this.proposalBusy||!this.proposalDraftBody.trim()||w,i.title=w?"Save changes before arming":"",i.addEventListener("click",()=>void this.setProposalState("armed")),m.appendChild(i),v=i}t.appendChild(m),p.addEventListener("input",()=>{this.proposalDraftBody=p.value;let i=T(),w=this.proposalDraftBody.trim().length>0;g.disabled=this.proposalBusy||r||!i,v&&(v.disabled=this.proposalBusy||!w||i,v.title=i?"Save changes before arming":"")});let k=document.createElement("div");if(k.className="proposal-status-line",r)k.textContent=s==="posting"?"Posting now\u2026":'Armed \u2014 waiting for "Help Wanted" label';else if(this.proposal){let i=this.proposal.updated_at?new Date(this.proposal.updated_at).toLocaleString():"";k.textContent=`Draft saved \xB7 ${i}`}else k.textContent='Auto-posts on "Help Wanted" via the poll worker.';if(t.appendChild(k),n&&this.proposal?.last_error){let i=document.createElement("div");i.className="proposal-error",i.textContent=`Last error: ${this.proposal.last_error}`,t.appendChild(i)}e.appendChild(t),this.root.appendChild(e)}async saveProposal(){if(this.proposalBusy)return;this.proposalBusy=!0,this.render();let e=await c({type:"SAVE_PROPOSAL",owner:this.owner,repo:this.repo,number:this.number,body:this.proposalDraftBody});this.proposalBusy=!1,e.ok&&e.data?(this.proposal=e.data,this.proposalDraftBody=e.data.body):(this.error=e.error??"Save failed",setTimeout(()=>{this.error=null,this.render()},3e3)),this.render()}async setProposalState(e){if(this.proposalBusy)return;this.proposalBusy=!0,this.render();let t=await c({type:e==="armed"?"ARM_PROPOSAL":"DISARM_PROPOSAL",owner:this.owner,repo:this.repo,number:this.number});this.proposalBusy=!1,t.ok&&t.data?(this.proposal=t.data,t.data.state==="armed"||t.data.state==="posting"?(this.startProposalPoll(),this.startFastPath()):(this.stopProposalPoll(),this.stopFastPath())):(this.error=t.error??"Update failed",setTimeout(()=>{this.error=null,this.render()},3e3)),this.render()}startProposalPoll(){this.stopProposalPoll(),this.proposalPollHandle=setInterval(()=>{this.refreshProposal()},G)}stopProposalPoll(){this.proposalPollHandle!==null&&(clearInterval(this.proposalPollHandle),this.proposalPollHandle=null)}async refreshProposal(){if(this.destroyed)return;let e=await c({type:"QUERY_PROPOSAL",owner:this.owner,repo:this.repo,number:this.number});if(this.destroyed||!e.ok||!e.data)return;let t=e.data;(!this.proposal||t.state!==this.proposal.state||t.posted_at!==this.proposal.posted_at)&&(this.proposal=t,(t.state==="posted"||t.state==="failed"||t.state==="draft")&&(this.stopProposalPoll(),this.stopFastPath()),this.render())}startFastPath(){if(this.autoPostEnabled&&!(!this.proposal||this.proposal.state!=="armed")&&!this.fastPathTriggered){if(this.hasReadyLabel()){this.tryFastPost("initial-labels");return}this.attachFastPathObservers(),this.startFastPathPoll(),this.fastPathVisibilityListener||(this.fastPathVisibilityListener=()=>{document.visibilityState==="visible"&&this.proposal?.state==="armed"?this.startFastPathPoll():this.stopFastPathPoll()},document.addEventListener("visibilitychange",this.fastPathVisibilityListener))}}stopFastPath(){this.stopFastPathPoll();for(let e of this.fastPathObservers)e.disconnect();this.fastPathObservers=[],this.fastPathVisibilityListener&&(document.removeEventListener("visibilitychange",this.fastPathVisibilityListener),this.fastPathVisibilityListener=null),this.fastPathEtag=null}attachFastPathObservers(){let e=new Set;for(let t of q)document.querySelectorAll(t).forEach(s=>{if(e.has(s))return;e.add(s);let r=new MutationObserver(()=>this.checkLabelsContainer(s));r.observe(s,{childList:!0,subtree:!0,characterData:!0}),this.fastPathObservers.push(r),this.checkLabelsContainer(s)})}checkLabelsContainer(e){if(this.fastPathTriggered)return;(e.innerText||e.textContent||"").toLowerCase().includes(O)&&this.tryFastPost("mutation-observer")}startFastPathPoll(){this.fastPathHandle===null&&document.visibilityState==="visible"&&(this.fastPathHandle=setInterval(()=>{this.fastPollTick()},W),this.fastPollTick())}stopFastPathPoll(){this.fastPathHandle!==null&&(clearInterval(this.fastPathHandle),this.fastPathHandle=null)}async fastPollTick(){if(this.destroyed||this.fastPathTriggered)return;if(!this.proposal||this.proposal.state!=="armed"){this.stopFastPath();return}let e=await c({type:"QUERY_ISSUE_LABELS_ETAG",owner:this.owner,repo:this.repo,number:this.number,etag:this.fastPathEtag});!e.ok||!e.data||(e.data.etag&&(this.fastPathEtag=e.data.etag),!(e.data.notModified||!e.data.labels)&&(this.labels=e.data.labels,this.hasReadyLabel()&&this.tryFastPost("etag-poll")))}async tryFastPost(e){if(console.debug("[tasker] fast-post triggered via",e),this.fastPathTriggered||!this.autoPostEnabled||!this.proposal||this.proposal.state!=="armed")return;this.fastPathTriggered=!0,this.stopFastPath();let t=this.proposal.id;this.proposal={...this.proposal,state:"posting"},this.render();let s=await c({type:"POST_PROPOSAL_NOW",proposalId:t});this.destroyed||(s.ok&&s.data?(this.proposal=s.data,this.stopProposalPoll()):(this.fastPathTriggered=!1,this.refreshProposal()),this.render())}groupStatuses(){let e={todo:[],in_progress:[],complete:[]};for(let t of this.statuses)e[t.group_name]?.push(t);for(let t of S)e[t].sort((s,r)=>s.position-r.position);return e}escapeHtml(e){let t=document.createElement("span");return t.textContent=e,t.innerHTML}destroy(){this.destroyed=!0,this.stopProposalPoll(),this.stopFastPath(),this.container.remove()}getHeaderStyles(){return`
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

      .proposal-status-line {
        font-size: 11px;
        opacity: 0.7;
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
    `}};var I="extensionSettings";var h={autoRefreshEnabled:!1,autoRefreshSeconds:20,notifyHelpWanted:!1,notifyChannels:["browser"],telegramChatId:"",pollSeconds:45,watchedLabelGroups:[["Help Wanted"],["Daily"],["Bug"]],excludedLabels:["DeployBlocker","DeployBlockerCash"]},V=["browser","telegram"];function Y(a){if(!Array.isArray(a))return[...h.notifyChannels];let e=a.filter(t=>typeof t=="string"&&V.includes(t));return e.length>0?Array.from(new Set(e)):[...h.notifyChannels]}function C(a,e){if(!Array.isArray(a))return[...e];let t=a.filter(s=>typeof s=="string").map(s=>s.trim()).filter(s=>s.length>0&&s.length<=64);return Array.from(new Map(t.map(s=>[s.toLowerCase(),s])).values())}function j(a){if(!Array.isArray(a))return null;let e=[];for(let t of a){if(!Array.isArray(t))continue;let s=C(t,[]);s.length>0&&e.push(s)}return e}async function A(){let e=(await chrome.storage.local.get(I))[I],t,s=j(e?.watchedLabelGroups);return s!==null?t=s:e?.watchedLabels!==void 0?t=C(e.watchedLabels,[]).map(r=>[r]):t=h.watchedLabelGroups.map(r=>[...r]),{autoRefreshEnabled:e?.autoRefreshEnabled??h.autoRefreshEnabled,autoRefreshSeconds:Math.max(5,e?.autoRefreshSeconds??h.autoRefreshSeconds),notifyHelpWanted:e?.notifyHelpWanted??h.notifyHelpWanted,notifyChannels:Y(e?.notifyChannels),telegramChatId:e?.telegramChatId??h.telegramChatId,pollSeconds:Math.max(30,e?.pollSeconds??h.pollSeconds),watchedLabelGroups:t,excludedLabels:e?.excludedLabels===void 0?[...h.excludedLabels]:C(e.excludedLabels,[])}}function B(a,e){return`seenHelpWanted:${a.toLowerCase()}/${e.toLowerCase()}`}async function D(a,e){let t=B(a,e),r=(await chrome.storage.local.get(t))[t]??[];return new Set(r)}async function U(a,e,t){let s=Array.from(t),r=s.length>500?s.slice(s.length-500):s;await chrome.storage.local.set({[B(a,e)]:r})}function Q(a){return a.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}function $(a){let e=Q(a).replace(/\s+/g,"[\\s-]?");return new RegExp(`(?:^|[^a-z0-9])${e}(?:$|[^a-z0-9])`,"i")}function K(a,e){let t=[];for(let s of e){if(s.length===0)continue;s.every(o=>$(o).test(a))&&t.push(s.join(" + "))}return t}function X(a,e){for(let t of e)if($(t).test(a))return!0;return!1}function J(a,e){let t=new Map;if(a.length===0)return[];let s=new Set;document.querySelectorAll('[data-testid="list-view-item"], [data-testid="list-view-items"] > li, div[id^="issue_"], li[id^="issue_"]').forEach(r=>s.add(r)),s.size===0&&document.querySelectorAll('a[href*="/issues/"]').forEach(r=>{let o=r.closest('li, article, div[role="listitem"]');o&&s.add(o)});for(let r of s){let o=r.textContent??"";if(X(o,e))continue;let n=K(o,a);if(n.length===0)continue;let l=r.querySelector('a[data-testid="issue-pr-title-link"], a[id^="issue_"][href*="/issues/"], a[href*="/issues/"]');if(!l)continue;let d=l.href,u=d.match(/\/issues\/(\d+)(?:[?#].*)?$/);if(!u)continue;let p=parseInt(u[1],10);if(!Number.isFinite(p)||p<=0||t.has(p))continue;let m=(l.textContent??"").trim()||`Issue #${p}`;t.set(p,{number:p,title:m,url:d,labels:n})}return Array.from(t.values())}var E=class{constructor(e,t){this.owner=e;this.repo=t}refreshTimer=null;scanTimer=null;destroyed=!1;async init(){this.scanTimer=window.setTimeout(()=>{this.runScan(!0)},1500);let e=await A();if(e.autoRefreshEnabled){let t=Math.max(5,e.autoRefreshSeconds)*1e3;this.refreshTimer=window.setTimeout(()=>{this.destroyed||window.location.reload()},t)}}async runScan(e){if(!this.destroyed)try{let t=await A(),s=J(t.watchedLabelGroups,t.excludedLabels),r=await D(this.owner,this.repo),o=t.notifyHelpWanted,n=s.filter(d=>!r.has(d.number));if(n.length===0)return;let l=r.size===0&&e;for(let d of n)r.add(d.number);if(await U(this.owner,this.repo,r),l||!o)return;for(let d of n.slice(0,10)){let u={type:"SEND_HELP_WANTED",owner:this.owner,repo:this.repo,number:d.number,title:d.title,url:d.url,labels:d.labels};chrome.runtime.sendMessage(u).catch(()=>{})}}catch{}}destroy(){this.destroyed=!0,this.refreshTimer!==null&&(clearTimeout(this.refreshTimer),this.refreshTimer=null),this.scanTimer!==null&&(clearTimeout(this.scanTimer),this.scanTimer=null)}};var f=null,x=null,L="";function Z(){return document.querySelector('[class*="sidebarContent"]')??document.querySelector(".Layout-sidebar .BorderGrid")??null}function ee(){return document.querySelector('[class*="PageHeader-Description"] .d-flex.flex-justify-between')??null}function te(){let a=document.querySelector(".js-comment-body")??document.querySelector('[data-testid="issue-body"]');if(!a)return[];let e=new Set,t=a.querySelectorAll('a[href*="/issues/"]');for(let o of t){let l=o.href.match(/\/issues\/(\d+)/);l&&e.add(parseInt(l[1],10))}let r=(a.textContent??"").matchAll(/#(\d{2,})/g);for(let o of r)e.add(parseInt(o[1],10));return Array.from(e)}function _(){let a=window.location.href;if(a===L)return;L=a,f&&(f.destroy(),f=null),x&&(x.destroy(),x=null);let e=H(a);if(e){x=new E(e.owner,e.repo),x.init();return}let t=M(a);if(!t)return;let s=(r=0)=>{if(t.type==="pr"){let o=ee();if(!o){r<20&&setTimeout(()=>s(r+1),250);return}let n=te();f=new y(t.owner,t.repo,t.number,"pr",n),o.appendChild(f.element),f.init()}else{let o=Z();if(!o){r<20&&setTimeout(()=>s(r+1),250);return}f=new y(t.owner,t.repo,t.number,"issue",[]),o.appendChild(f.element),f.init()}};s()}_();document.addEventListener("turbo:load",()=>{L="",_()});var z=window.location.href;setInterval(()=>{window.location.href!==z&&(z=window.location.href,L="",_())},1e3);})();
