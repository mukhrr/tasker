"use strict";(()=>{function z(a){let e=a.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/?(?:\?.*)?(?:#.*)?$/);return e?{owner:e[1],repo:e[2]}:null}function $(a){let e=a.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);if(e)return{owner:e[1],repo:e[2],number:parseInt(e[3],10),type:"issue"};let t=a.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);return t?{owner:t[1],repo:t[2],number:parseInt(t[3],10),type:"pr"}:null}var R={gray:"#6b7280",yellow:"#eab308",green:"#22c55e",red:"#ef4444",blue:"#3b82f6",purple:"#a855f7",pink:"#ec4899",orange:"#f97316"},D={todo:"To-do",in_progress:"In Progress",complete:"Complete"},N=["todo","in_progress","complete"];var K=["bug","daily"],J="help wanted",Z=2e3;function c(a){return chrome.runtime.sendMessage(a)}function G(){return document.documentElement.getAttribute("data-color-mode")==="dark"||document.documentElement.getAttribute("data-dark-theme")==="dark"||document.documentElement.classList.contains("dark")}function P(a){return R[a]??R.gray}var C=class{container;shadow;root;task=null;linkedTasks=[];statuses=[];dropdownOpen=!1;loading=!0;error=null;owner;repo;number;mode;linkedIssueNumbers;labels=[];proposal=null;proposalDraftBody="";proposalBusy=!1;proposalPollHandle=null;proposalNotice=null;destroyed=!1;analysis=null;analysisBusy=!1;analysisPollTimer=null;autoPostEnabled=!0;constructor(e,t,s,o="issue",r=[]){this.owner=e,this.repo=t,this.number=s,this.mode=o,this.linkedIssueNumbers=r,this.container=document.createElement("div"),this.container.id="tasker-status-widget",o==="pr"&&(this.container.style.display="inline-flex",this.container.style.alignItems="center",this.container.style.flexShrink="0",this.container.style.alignSelf="start",this.container.style.position="relative"),this.shadow=this.container.attachShadow({mode:"closed"}),this.root=document.createElement("div"),this.shadow.appendChild(this.root);let n=document.createElement("style");n.textContent=this.mode==="pr"?this.getHeaderStyles():this.getSidebarStyles(),this.shadow.appendChild(n),document.addEventListener("click",l=>{!this.container.contains(l.target)&&this.dropdownOpen&&(this.dropdownOpen=!1,this.render())})}get element(){return this.container}async init(){this.loading=!0,this.error=null,this.render();try{let e=await c({type:"GET_SESSION"});if(!e.ok||!e.data){this.loading=!1,this.error="Not signed in to Tasker",this.render();return}this.mode==="pr"?await this.initPr():await this.initIssue()}catch(e){this.error=e.message??"Connection error"}this.loading=!1,this.render()}async initIssue(){let[e,t,s,o,r,n]=await Promise.all([c({type:"QUERY_TASK",owner:this.owner,repo:this.repo,number:this.number}),c({type:"QUERY_STATUSES"}),c({type:"QUERY_ISSUE_LABELS",owner:this.owner,repo:this.repo,number:this.number}),c({type:"QUERY_PROPOSAL",owner:this.owner,repo:this.repo,number:this.number}),c({type:"GET_AUTOPOST"}),c({type:"QUERY_ANALYSIS",owner:this.owner,repo:this.repo,number:this.number})]);e.ok?this.task=e.data??null:this.error=e.error??"Failed to load task",t.ok&&t.data&&(this.statuses=t.data),s.ok&&s.data&&(this.labels=s.data),o.ok&&(this.proposal=o.data??null,this.proposalDraftBody=this.proposal?.body??""),r.ok&&r.data&&(this.autoPostEnabled=r.data.enabled),n.ok&&(this.analysis=n.data??null,this.analysis&&(this.analysis.state==="queued"||this.analysis.state==="running")&&this.startAnalysisPoll());let l=["queued","drafting","armed","posting"];this.proposal&&l.includes(this.proposal.state)&&this.startProposalPoll(),this.proposal?.state==="posted"&&this.proposal.github_comment_id&&this.verifyPostedComment()}async verifyPostedComment(){if(!this.proposal||this.proposal.state!=="posted")return;let e=this.proposal.id,t=await c({type:"VERIFY_POSTED_COMMENT",proposalId:e});if(!this.destroyed&&!(!t.ok||!t.data)&&t.data.state!==this.proposal?.state){let s=t.data.state==="draft";this.proposal=t.data,this.proposalDraftBody=t.data.body??"",s&&(this.proposalNotice="Previous comment was deleted on GitHub \u2014 reverted to draft.",setTimeout(()=>{this.destroyed||(this.proposalNotice=null,this.render())},8e3)),this.render()}}async initPr(){if(this.linkedIssueNumbers.length===0){this.error="No linked issues found";return}let[e,t]=await Promise.all([c({type:"QUERY_TASKS_BATCH",owner:this.owner,repo:this.repo,issueNumbers:this.linkedIssueNumbers}),c({type:"QUERY_STATUSES"})]);e.ok?this.linkedTasks=e.data??[]:this.error=e.error??"Failed to load tasks",t.ok&&t.data&&(this.statuses=t.data)}render(){this.mode==="pr"?this.renderPr():this.renderSidebar()}renderPr(){let e=G();if(this.root.innerHTML="",this.root.className=`tasker-header ${e?"dark":"light"}`,this.loading){this.root.innerHTML='<button class="tasker-btn" disabled><div class="spinner"></div> Tasker</button>';return}if(this.error){this.root.innerHTML="";return}this.linkedTasks.length!==0&&this.renderPrStatusBadge()}renderPrStatusBadge(){let t=new Set(this.linkedTasks.map(p=>p.status)).size>1,s,o,r;if(t)o=R.purple,r="Mixed";else{let p=this.linkedTasks[0].status;s=this.statuses.find(h=>h.key===p),o=P(s?s.color:"gray"),r=s?.label??p}let n=document.createElement("div");n.className="tasker-wrapper";let l=document.createElement("button");l.className="tasker-btn has-status",l.innerHTML=`
      <span class="tasker-icon">T</span>
      <span class="dot" style="background:${o}"></span>
      <span class="status-label">${this.escapeHtml(r)}</span>
      <span class="linked-count">${this.linkedTasks.length} issue${this.linkedTasks.length>1?"s":""}</span>
      <span class="chevron">${this.dropdownOpen?"&#9650;":"&#9660;"}</span>
    `,l.addEventListener("click",p=>{p.stopPropagation(),this.dropdownOpen=!this.dropdownOpen,this.render()}),n.appendChild(l),this.root.appendChild(n),this.dropdownOpen&&this.root.appendChild(this.renderPrDropdown())}renderPrDropdown(){let e=document.createElement("div");e.className="dropdown";let t=document.createElement("div");t.className="linked-notice",t.innerHTML=`Updating <strong>${this.linkedTasks.length}</strong> tracked issue${this.linkedTasks.length>1?"s":""}: ${this.linkedTasks.map(o=>`#${o.issue_number}`).join(", ")}`,e.appendChild(t);let s=this.groupStatuses();for(let o of N){let r=s[o];if(!r||r.length===0)continue;let n=document.createElement("div");n.className="group-label",n.textContent=D[o],e.appendChild(n);for(let l of r){let p=this.linkedTasks.every(f=>f.status===l.key),h=document.createElement("button");h.className=`status-row ${p?"active":""}`,h.innerHTML=`
          <span class="dot" style="background:${P(l.color)}"></span>
          <span class="label">${this.escapeHtml(l.label)}</span>
        `,h.addEventListener("click",async f=>{f.stopPropagation(),await this.updateLinkedStatuses(l.key,l.group_name)}),e.appendChild(h)}}return e}async updateLinkedStatuses(e,t){let s=this.linkedTasks.map(n=>({status:n.status,group:n.status_group}));for(let n of this.linkedTasks)n.status=e,n.status_group=t;this.dropdownOpen=!1,this.render();let o=this.linkedTasks.map(n=>n.issue_number).filter(n=>n!==null),r=await c({type:"UPDATE_LINKED_STATUSES",owner:this.owner,repo:this.repo,issueNumbers:o,status:e,statusGroup:t});r.ok||(this.linkedTasks.forEach((n,l)=>{n.status=s[l].status,n.status_group=s[l].group}),this.error=r.error??"Update failed",this.render(),setTimeout(()=>{this.error=null,this.render()},3e3))}renderSidebar(){let e=G();if(this.root.innerHTML="",this.root.className=`tasker-root ${e?"dark":"light"}`,this.loading){this.root.innerHTML='<div class="section"><div class="header">Tasker</div><div class="spinner-wrap"><div class="spinner"></div></div></div>';return}if(this.error){this.root.innerHTML=`
        <div class="section">
          <div class="header">Tasker</div>
          <div class="error-msg">${this.escapeHtml(this.error)}</div>
          <button class="retry-btn">Retry</button>
        </div>`,this.root.querySelector(".retry-btn")?.addEventListener("click",()=>this.init());return}if(!this.task){this.renderAddButton();return}this.renderStatusBadge()}renderAddButton(){let e=document.createElement("div");e.className="section",e.innerHTML='<div class="header">Tasker</div>';let t=document.createElement("button");t.className="add-btn",t.textContent="Add to Tasker",t.addEventListener("click",async()=>{t.disabled=!0,t.textContent="Adding...";let s=await c({type:"CREATE_TASK",owner:this.owner,repo:this.repo,number:this.number});s.ok&&s.data?(this.task=s.data,this.render()):(t.textContent=s.error??"Failed",setTimeout(()=>{t.disabled=!1,t.textContent="Add to Tasker"},2e3))}),e.appendChild(t),this.root.appendChild(e),this.renderAnalysisPanel(),this.renderProposalPanel()}renderStatusBadge(){let e=this.task,t=this.statuses.find(l=>l.key===e.status),s=P(t?t.color:"gray"),o=t?.label??e.status,r=document.createElement("div");r.className="section",r.innerHTML='<div class="header">Tasker</div>';let n=document.createElement("button");n.className="status-badge",n.innerHTML=`
      <span class="dot" style="background:${s}"></span>
      <span class="label">${this.escapeHtml(o)}</span>
      <span class="chevron">${this.dropdownOpen?"&#9650;":"&#9660;"}</span>
    `,n.addEventListener("click",l=>{l.stopPropagation(),this.dropdownOpen=!this.dropdownOpen,this.render()}),r.appendChild(n),this.dropdownOpen&&r.appendChild(this.renderDropdown()),this.root.appendChild(r),this.renderAnalysisPanel(),this.renderProposalPanel()}renderDropdown(){let e=document.createElement("div");e.className="dropdown";let t=this.groupStatuses();for(let s of N){let o=t[s];if(!o||o.length===0)continue;let r=document.createElement("div");r.className="group-label",r.textContent=D[s],e.appendChild(r);for(let n of o){let l=document.createElement("button");l.className=`status-row ${this.task?.status===n.key?"active":""}`,l.innerHTML=`
          <span class="dot" style="background:${P(n.color)}"></span>
          <span class="label">${this.escapeHtml(n.label)}</span>
        `,l.addEventListener("click",async p=>{p.stopPropagation(),await this.updateStatus(n.key,n.group_name)}),e.appendChild(l)}}return e}async updateStatus(e,t){if(!this.task)return;let s=this.task.status,o=this.task.status_group;this.task.status=e,this.task.status_group=t,this.dropdownOpen=!1,this.render();let r=await c({type:"UPDATE_STATUS",taskId:this.task.id,status:e,statusGroup:t});r.ok||(this.task.status=s,this.task.status_group=o,this.error=r.error??"Update failed",this.render(),setTimeout(()=>{this.error=null,this.render()},3e3))}hasReadyLabel(){return this.labels.some(e=>e.toLowerCase()===J)}hasRequiredDraftLabels(){let e=this.labels.map(t=>t.toLowerCase());return K.every(t=>e.includes(t))}isProposalPanelEligible(){return this.mode==="issue"}renderProposalPanel(){if(!this.isProposalPanelEligible())return;let e=document.createElement("div");e.className="section proposal",e.innerHTML='<div class="header">Proposal</div>';let t=document.createElement("div");t.className="proposal-body";let s=this.proposal?.state??"draft",o=s==="armed"||s==="posting",r=s==="posted",n=s==="failed";if(s==="queued"||s==="drafting"){let i=s==="queued"?"Queued for auto-drafting\u2026":"Auto-drafting proposal\u2026",d=document.createElement("div");d.className="proposal-status",d.innerHTML=`
        <span class="check">\u{1F916}</span>
        <div>
          <div class="proposal-status-line">${this.escapeHtml(i)}</div>
          <div class="proposal-status-sub">A proposal is being written and will arm automatically.</div>
        </div>
      `,t.appendChild(d);let u=document.createElement("div");u.className="proposal-actions";let b=document.createElement("button");b.className="proposal-btn",b.textContent=this.proposalBusy?"Cancelling\u2026":"Cancel",b.disabled=this.proposalBusy,b.title="Stop auto-drafting and keep this as an editable draft.",b.addEventListener("click",()=>void this.cancelAutoDraft()),u.appendChild(b),t.appendChild(u),e.appendChild(t),this.root.appendChild(e);return}if(r){let i=this.proposal?.posted_at?new Date(this.proposal.posted_at).toLocaleString():"";t.innerHTML=`
        <div class="proposal-status posted">
          <span class="check">\u2713</span>
          <div>
            <div class="proposal-status-line">Posted ${this.escapeHtml(i)}</div>
            ${this.proposal?.github_comment_id?`<a class="comment-link" href="https://github.com/${this.escapeHtml(this.owner)}/${this.escapeHtml(this.repo)}/issues/${this.number}#issuecomment-${this.proposal.github_comment_id}" target="_blank" rel="noopener">View comment \u2192</a>`:""}
          </div>
        </div>
      `;let d=document.createElement("div");d.className="proposal-actions";let u=document.createElement("button");u.className="proposal-btn",u.textContent="Copy proposal",u.disabled=!this.proposal?.body,u.title="Copy the posted proposal text to the clipboard.",u.addEventListener("click",()=>{let X=this.proposal?.body??"";navigator.clipboard.writeText(X).then(()=>{u.textContent="Copied \u2713"}).catch(()=>{u.textContent="Copy failed"}).finally(()=>{setTimeout(()=>{u.textContent="Copy proposal"},1500)})}),d.appendChild(u);let b=document.createElement("button");b.className="proposal-btn",b.textContent=this.proposalBusy?"Clearing\u2026":"Clear from Tasker",b.disabled=this.proposalBusy,b.title="Remove this record from Tasker. The posted GitHub comment is not deleted.",b.addEventListener("click",()=>void this.clearProposal()),d.appendChild(b),t.appendChild(d),e.appendChild(t),this.root.appendChild(e);return}if(!o){let i=document.createElement("div");i.className="proposal-autopilot";let d=document.createElement("button");d.className="proposal-btn autopilot",d.textContent=this.proposalBusy?"Starting\u2026":"\u{1F916} Run Auto-pilot",d.disabled=this.proposalBusy,d.title="Let the server draft, validate, and arm this proposal automatically.",d.addEventListener("click",()=>void this.enqueueAutoDraft()),i.appendChild(d);let u=document.createElement("div");u.className="proposal-status-sub",u.textContent="Drafts with Codex, validates, and arms \u2014 no typing needed.",i.appendChild(u),t.appendChild(i)}if(this.proposalNotice){let i=document.createElement("div");i.className="proposal-notice",i.textContent=this.proposalNotice,t.appendChild(i)}if((s==="armed"||s==="posting")&&!this.autoPostEnabled){let i=document.createElement("div");i.className="proposal-notice danger",i.textContent="Auto-post is OFF in the Tasker popup \u2014 armed drafts are paused. Re-enable to post.",t.appendChild(i)}let h=this.hasReadyLabel(),f=this.hasRequiredDraftLabels();if(h){let i=document.createElement("div");i.className="proposal-notice",i.textContent='"Help Wanted" is already on this issue. Use \u201CPost now\u201D for an immediate manual post.',t.appendChild(i)}else if(!f){let i=document.createElement("div");i.className="proposal-notice subtle",i.textContent=this.labels.length?"Labels: "+this.labels.join(", ")+'. Will arm-and-wait for "Help Wanted".':'Labels not loaded. Will arm-and-wait for "Help Wanted" once added.',t.appendChild(i)}let m=document.createElement("textarea");m.className="proposal-textarea",m.rows=6,m.placeholder=`## Proposal

Describe your fix...`,m.value=this.proposalDraftBody,m.disabled=o||this.proposalBusy,t.appendChild(m);let g=document.createElement("div");g.className="proposal-actions";let E=()=>this.proposalDraftBody!==(this.proposal?.body??"")&&this.proposalDraftBody.trim().length>0,y=document.createElement("button");y.className="proposal-btn secondary",y.textContent=this.proposalBusy?"Saving\u2026":this.proposal?"Save changes":"Save draft",y.disabled=this.proposalBusy||o||!E(),y.addEventListener("click",()=>void this.saveProposal()),g.appendChild(y);let x=null;if(o){let i=document.createElement("button");i.className="proposal-btn",i.textContent=s==="posting"?"Posting\u2026":"Disarm",i.disabled=this.proposalBusy||s==="posting",i.addEventListener("click",()=>void this.setProposalState("draft")),g.appendChild(i)}else{let i=document.createElement("button");i.className="proposal-btn primary",i.textContent=this.proposalBusy?"Arming\u2026":"Arm auto-post";let d=E();i.disabled=this.proposalBusy||!this.proposalDraftBody.trim()||d,i.title=d?"Save changes before arming":"",i.addEventListener("click",()=>void this.setProposalState("armed")),g.appendChild(i),x=i}t.appendChild(g);let v=null;if(s!=="posting"){let i=document.createElement("div");i.className="proposal-actions";let d=document.createElement("button");d.className="proposal-btn danger",d.textContent=this.proposalBusy?"Posting\u2026":"Post now";let u=this.proposalDraftBody.trim().length>0;d.disabled=this.proposalBusy||!u,d.title=u?"Post the current text as a comment immediately, without waiting for Help Wanted.":"Type your proposal first.",d.addEventListener("click",()=>void this.postProposalNow()),i.appendChild(d),t.appendChild(i),v=d}if(this.proposal){let i=document.createElement("div");i.className="proposal-actions";let d=document.createElement("button");d.className="proposal-btn",d.textContent=this.proposalBusy?"Clearing\u2026":"Clear draft",d.disabled=this.proposalBusy,d.title="Delete this saved proposal from Tasker and start over.",d.addEventListener("click",()=>void this.clearProposal()),i.appendChild(d),t.appendChild(i)}m.addEventListener("input",()=>{this.proposalDraftBody=m.value;let i=E(),d=this.proposalDraftBody.trim().length>0;y.disabled=this.proposalBusy||o||!i,x&&(x.disabled=this.proposalBusy||!d||i,x.title=i?"Save changes before arming":""),v&&(v.disabled=this.proposalBusy||!d,v.title=d?"Post the current text as a comment immediately, without waiting for Help Wanted.":"Type your proposal first.")});let T=document.createElement("div");if(T.className="proposal-status-line",o)T.textContent=s==="posting"?"Posting now\u2026":'Armed \u2014 waiting for "Help Wanted" label';else if(this.proposal){let i=this.proposal.updated_at?new Date(this.proposal.updated_at).toLocaleString():"";T.textContent=`Draft saved \xB7 ${i}`}else T.textContent='Auto-posts on "Help Wanted" via the poll worker.';if(t.appendChild(T),n&&this.proposal?.last_error){let i=document.createElement("div");i.className="proposal-error",i.textContent=`Last error: ${this.proposal.last_error}`,t.appendChild(i)}e.appendChild(t),this.root.appendChild(e)}async saveProposal(){if(this.proposalBusy)return;this.proposalBusy=!0,this.render();let e=await c({type:"SAVE_PROPOSAL",owner:this.owner,repo:this.repo,number:this.number,body:this.proposalDraftBody});this.proposalBusy=!1,e.ok&&e.data?(this.proposal=e.data,this.proposalDraftBody=e.data.body):(this.error=e.error??"Save failed",setTimeout(()=>{this.error=null,this.render()},3e3)),this.render()}async setProposalState(e){if(this.proposalBusy)return;this.proposalBusy=!0,this.render();let t=await c({type:e==="armed"?"ARM_PROPOSAL":"DISARM_PROPOSAL",owner:this.owner,repo:this.repo,number:this.number});this.proposalBusy=!1,t.ok&&t.data?(this.proposal=t.data,t.data.state==="armed"||t.data.state==="posting"?this.startProposalPoll():this.stopProposalPoll()):(this.error=t.error??"Update failed",setTimeout(()=>{this.error=null,this.render()},3e3)),this.render()}async enqueueAutoDraft(){if(this.proposalBusy)return;this.proposalBusy=!0,this.render();let e=await c({type:"ENQUEUE_AUTO_DRAFT",owner:this.owner,repo:this.repo,number:this.number});this.proposalBusy=!1,e.ok&&e.data?(this.proposal=e.data,this.startProposalPoll()):(this.error=e.error??"Could not start Auto-pilot",setTimeout(()=>{this.error=null,this.render()},3e3)),this.render()}async cancelAutoDraft(){if(this.proposalBusy)return;this.proposalBusy=!0,this.render();let e=await c({type:"CANCEL_AUTO_DRAFT",owner:this.owner,repo:this.repo,number:this.number});this.proposalBusy=!1,e.ok&&e.data?(this.proposal=e.data,this.proposalDraftBody=e.data.body??"",this.stopProposalPoll()):(this.error=e.error??"Could not cancel",setTimeout(()=>{this.error=null,this.render()},3e3)),this.render()}async clearProposal(){if(this.proposalBusy||!confirm("Clear this proposal? This deletes the saved draft from Tasker."))return;this.proposalBusy=!0,this.render();let e=await c({type:"CLEAR_PROPOSAL",owner:this.owner,repo:this.repo,number:this.number});this.proposalBusy=!1,e.ok?(this.proposal=null,this.proposalDraftBody="",this.proposalNotice=null,this.stopProposalPoll()):(this.error=e.error??"Could not clear",setTimeout(()=>{this.error=null,this.render()},3e3)),this.render()}async postProposalNow(){if(!(this.proposalBusy||!this.proposalDraftBody.trim())&&confirm("Post this proposal as a comment now?")){this.proposalBusy=!0,this.render();try{let t=await c({type:"SAVE_PROPOSAL",owner:this.owner,repo:this.repo,number:this.number,body:this.proposalDraftBody});if(!t.ok||!t.data){this.error=t.error??"Save failed",setTimeout(()=>{this.error=null,this.render()},3e3);return}this.proposal=t.data,this.proposal={...this.proposal,state:"posting"},this.startProposalPoll(),this.render();let s=await c({type:"POST_PROPOSAL_NOW",proposalId:t.data.id,force:!0});s.ok&&s.data?(this.proposal=s.data,(s.data.state==="posted"||s.data.state==="failed")&&this.stopProposalPoll()):(this.error=s.error??"Post failed",setTimeout(()=>{this.error=null,this.render()},5e3),this.refreshProposal())}catch(t){console.error("[tasker] postProposalNow threw",t),this.error=t instanceof Error?t.message:"Post failed (channel closed)",setTimeout(()=>{this.error=null,this.render()},5e3)}finally{this.proposalBusy=!1,this.render()}}}startProposalPoll(){this.stopProposalPoll(),this.proposalPollHandle=setInterval(()=>{this.refreshProposal()},Z)}stopProposalPoll(){this.proposalPollHandle!==null&&(clearInterval(this.proposalPollHandle),this.proposalPollHandle=null)}async refreshProposal(){if(this.destroyed)return;let e=await c({type:"QUERY_PROPOSAL",owner:this.owner,repo:this.repo,number:this.number});if(this.destroyed||!e.ok||!e.data)return;let t=e.data;(!this.proposal||t.state!==this.proposal.state||t.posted_at!==this.proposal.posted_at||t.body!==this.proposal.body)&&(this.proposal=t,this.proposalDraftBody=t.body??"",(t.state==="posted"||t.state==="failed"||t.state==="draft")&&this.stopProposalPoll(),this.render())}groupStatuses(){let e={todo:[],in_progress:[],complete:[]};for(let t of this.statuses)e[t.group_name]?.push(t);for(let t of N)e[t].sort((s,o)=>s.position-o.position);return e}escapeHtml(e){let t=document.createElement("span");return t.textContent=e,t.innerHTML}renderAnalysisPanel(){let e=document.createElement("div");e.className="section proposal";let t=document.createElement("div");t.className="proposal-body";let s=this.analysis?.state??null,o=s==="queued"||s==="running",r=document.createElement("div");r.className="proposal-actions";let n=document.createElement("button");if(n.className="proposal-btn autopilot",n.textContent=this.analysisBusy?"Queuing\u2026":o?s==="queued"?"\u23F3 Analysis queued\u2026":"\u{1F52C} Analyzing\u2026":s==="done"||s==="failed"||s==="canceled"?"\u{1F9E0} Re-run Claude analysis":"\u{1F9E0} Run Claude analysis",n.disabled=this.analysisBusy||o,n.title="Runs Claude Code on your machine: reproduce the bug, apply a local fix (no commit), update the proposal, stash the changes, and ping Telegram. Requires the analyzer daemon to be running.",n.addEventListener("click",()=>void this.runAnalysis()),r.appendChild(n),o){let p=document.createElement("button");p.className="proposal-btn",p.textContent=this.analysisBusy?"Cancelling\u2026":"Cancel",p.disabled=this.analysisBusy,p.title="Stop this analysis. A running claude is killed; partial work is parked in a stash.",p.addEventListener("click",()=>void this.cancelAnalysis()),r.appendChild(p)}t.appendChild(r);let l=document.createElement("div");if(l.className="proposal-status-sub",s==="done"){let p=(this.analysis?.result_summary??"").slice(0,240);l.textContent=`\u2705 ${p||"Analysis finished."}${this.analysis?.stash_ref?` \xB7 stash: ${this.analysis.stash_ref}`:""}`}else s==="failed"?l.textContent=`\u26A0\uFE0F ${(this.analysis?.last_error??"Analysis failed").slice(0,240)}`:s==="canceled"?l.textContent="\u{1F6AB} Canceled \u2014 re-run anytime.":s==="running"?l.textContent="Claude is reproducing and fixing locally \u2014 result lands here and on Telegram.":s==="queued"?l.textContent="Waiting for the analyzer daemon on your Mac to pick this up.":l.textContent="Reproduce \u2192 fix locally \u2192 update proposal \u2192 stash. Needs the local analyzer running.";t.appendChild(l),e.appendChild(t),this.root.appendChild(e)}async runAnalysis(){if(this.analysisBusy)return;this.analysisBusy=!0,this.render();let e=await c({type:"RUN_ANALYSIS",owner:this.owner,repo:this.repo,number:this.number});this.analysisBusy=!1,e.ok&&e.data?(this.analysis=e.data,this.startAnalysisPoll()):(this.error=e.error??"Could not queue analysis",setTimeout(()=>{this.error=null,this.render()},3e3)),this.render()}async cancelAnalysis(){if(this.analysisBusy)return;this.analysisBusy=!0,this.render();let e=await c({type:"CANCEL_ANALYSIS",owner:this.owner,repo:this.repo,number:this.number});this.analysisBusy=!1,e.ok&&e.data?(this.analysis=e.data,this.stopAnalysisPoll()):(this.error=e.error??"Could not cancel",setTimeout(()=>{this.error=null,this.render()},3e3)),this.render()}startAnalysisPoll(){this.stopAnalysisPoll(),this.analysisPollTimer=window.setInterval(()=>{(async()=>{if(this.destroyed)return;let e=await c({type:"QUERY_ANALYSIS",owner:this.owner,repo:this.repo,number:this.number});if(this.destroyed||!e.ok)return;let t=e.data??null,s=JSON.stringify(t)!==JSON.stringify(this.analysis);this.analysis=t,(!t||t.state!=="queued"&&t.state!=="running")&&this.stopAnalysisPoll(),s&&this.render()})()},15e3)}stopAnalysisPoll(){this.analysisPollTimer!==null&&(clearInterval(this.analysisPollTimer),this.analysisPollTimer=null)}destroy(){this.destroyed=!0,this.stopProposalPoll(),this.stopAnalysisPoll(),this.container.remove()}getHeaderStyles(){return`
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

      .proposal-autopilot {
        margin-bottom: 8px;
      }
      .proposal-btn.autopilot {
        width: 100%;
        background: linear-gradient(135deg, #7c3aed, #2563eb);
        color: #ffffff;
        border-color: transparent;
        font-weight: 600;
      }
      .proposal-btn.autopilot:hover:not(:disabled) {
        background: linear-gradient(135deg, #6d28d9, #1d4ed8);
      }

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
    `}};var W="extensionSettings";var k={autoRefreshEnabled:!1,autoRefreshSeconds:20,notifyHelpWanted:!1,notifyChannels:["browser"],telegramChatId:"",pollSeconds:45,watchedLabelGroups:[["Help Wanted"],["Daily"],["Bug"]],excludedLabels:["DeployBlocker","DeployBlockerCash"],bugDailyPopupEnabled:!0,bugDailyPopupSound:!0},ee=["browser","telegram"];function te(a){if(!Array.isArray(a))return[...k.notifyChannels];let e=a.filter(t=>typeof t=="string"&&ee.includes(t));return e.length>0?Array.from(new Set(e)):[...k.notifyChannels]}function M(a,e){if(!Array.isArray(a))return[...e];let t=a.filter(s=>typeof s=="string").map(s=>s.trim()).filter(s=>s.length>0&&s.length<=64);return Array.from(new Map(t.map(s=>[s.toLowerCase(),s])).values())}function se(a){if(!Array.isArray(a))return null;let e=[];for(let t of a){if(!Array.isArray(t))continue;let s=M(t,[]);s.length>0&&e.push(s)}return e}async function H(){let e=(await chrome.storage.local.get(W))[W],t,s=se(e?.watchedLabelGroups);return s!==null?t=s:e?.watchedLabels!==void 0?t=M(e.watchedLabels,[]).map(o=>[o]):t=k.watchedLabelGroups.map(o=>[...o]),{autoRefreshEnabled:e?.autoRefreshEnabled??k.autoRefreshEnabled,autoRefreshSeconds:Math.max(5,e?.autoRefreshSeconds??k.autoRefreshSeconds),notifyHelpWanted:e?.notifyHelpWanted??k.notifyHelpWanted,notifyChannels:te(e?.notifyChannels),telegramChatId:e?.telegramChatId??k.telegramChatId,pollSeconds:Math.max(30,e?.pollSeconds??k.pollSeconds),watchedLabelGroups:t,excludedLabels:e?.excludedLabels===void 0?[...k.excludedLabels]:M(e.excludedLabels,[]),bugDailyPopupEnabled:e?.bugDailyPopupEnabled??k.bugDailyPopupEnabled,bugDailyPopupSound:e?.bugDailyPopupSound??k.bugDailyPopupSound}}function q(a,e,t="seenHelpWanted"){return`${t}:${a.toLowerCase()}/${e.toLowerCase()}`}async function I(a,e,t){let s=q(a,e,t),r=(await chrome.storage.local.get(s))[s]??[];return new Set(r)}async function O(a,e,t,s){let o=Array.from(t),r=o.length>500?o.slice(o.length-500):o;await chrome.storage.local.set({[q(a,e,s)]:r})}var Y="tasker-issue-alert";var S=null;function oe(){try{let a=window.AudioContext||window.webkitAudioContext;if(!a)return;S=S??new a,S.state==="suspended"&&S.resume();let e=S.currentTime;for(let[t,s]of[880,1320].entries()){let o=S.createOscillator(),r=S.createGain();o.type="sine",o.frequency.value=s;let n=e+t*.12;r.gain.setValueAtTime(1e-4,n),r.gain.exponentialRampToValueAtTime(.07,n+.02),r.gain.exponentialRampToValueAtTime(1e-4,n+.18),o.connect(r),r.connect(S.destination),o.start(n),o.stop(n+.2)}}catch{}}var re=`
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
`;function ae(){let a=document.getElementById(Y);if(a&&a.shadowRoot){let o=a.shadowRoot.querySelector(".stack");return{host:a,stack:o}}a=document.createElement("div"),a.id=Y,Object.assign(a.style,{position:"fixed",top:"0",left:"0",width:"0",height:"0",zIndex:"2147483647"}),document.body.appendChild(a);let e=a.attachShadow({mode:"open"}),t=document.createElement("style");t.textContent=re;let s=document.createElement("div");return s.className="stack",e.append(t,s),{host:a,stack:s}}function ne(a){let e=new Map;for(let t of a)for(let s of t.split("+")){let o=s.trim();o&&e.set(o.toLowerCase(),o)}return e.size>0?Array.from(e.values()):["New"]}function ie(a){let e=a.toLowerCase();return e.includes("bug")?"chip bug":e.includes("daily")?"chip daily":e.includes("help")?"chip help":e.includes("external")?"chip external":"chip generic"}function le(a,e){let t=document.createElement("div");t.className="card";let s=document.createElement("div");s.className="flash";let o=document.createElement("div");o.className="hd";let r=document.createElement("span");r.className="bolt",r.textContent="\u26A1";let n=document.createElement("span");n.className="badge",n.textContent="NEW BOUNTY";let l=document.createElement("button");l.className="x",l.textContent="\xD7",l.title="Dismiss",o.append(r,n,l);let p=document.createElement("div");p.className="title",p.textContent=`#${a.number} \xB7 ${a.title}`;let h=document.createElement("div");h.className="chips";for(let x of ne(a.labels)){let v=document.createElement("span");v.className=ie(x),v.textContent=x,h.append(v)}let f=document.createElement("div");f.className="hint",f.textContent="Open it and arm your proposal before someone grabs it.";let m=document.createElement("div");m.className="bar",m.style.animationDuration="15000ms",t.append(s,o,p,h,f,m);let g=null,E=!1,y=()=>{E||(E=!0,g&&clearTimeout(g),t.classList.add("out"),setTimeout(()=>{t.remove(),e()},280))};return t.addEventListener("click",()=>{window.open(a.url,"_blank","noopener"),y()}),l.addEventListener("click",x=>{x.stopPropagation(),y()}),t.addEventListener("mouseenter",()=>{g&&clearTimeout(g),m.style.animationPlayState="paused"}),t.addEventListener("mouseleave",()=>{E||(m.style.animationPlayState="running",g=setTimeout(y,15e3))}),g=setTimeout(y,15e3),t}function A(a,e={}){if(a.length===0)return;let{host:t,stack:s}=ae(),o=()=>{s.childElementCount===0&&t.remove()};for(let r of a.slice(0,5))s.appendChild(le(r,o));e.sound!==!1&&oe()}var F="seenBugDailyPopup";function de(a){return a.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}function j(a){let e=de(a).replace(/\s+/g,"[\\s-]?");return new RegExp(`(?:^|[^a-z0-9])${e}(?:$|[^a-z0-9])`,"i")}function pe(a,e){let t=[];for(let s of e){if(s.length===0)continue;s.every(r=>j(r).test(a))&&t.push(s.join(" + "))}return t}function ce(a,e){for(let t of e)if(j(t).test(a))return!0;return!1}function Q(a,e){let t=new Map;if(a.length===0)return[];let s=new Set;document.querySelectorAll('[data-testid="list-view-item"], [data-testid="list-view-items"] > li, div[id^="issue_"], li[id^="issue_"]').forEach(o=>s.add(o)),s.size===0&&document.querySelectorAll('a[href*="/issues/"]').forEach(o=>{let r=o.closest('li, article, div[role="listitem"]');r&&s.add(r)});for(let o of s){let r=o.textContent??"";if(ce(r,e))continue;let n=pe(r,a);if(n.length===0)continue;let l=o.querySelector('a[data-testid="issue-pr-title-link"], a[id^="issue_"][href*="/issues/"], a[href*="/issues/"]');if(!l)continue;let p=l.href,h=p.match(/\/issues\/(\d+)(?:[?#].*)?$/);if(!h)continue;let f=parseInt(h[1],10);if(!Number.isFinite(f)||f<=0||t.has(f))continue;let m=(l.textContent??"").trim()||`Issue #${f}`;t.set(f,{number:f,title:m,url:p,labels:n})}return Array.from(t.values())}var B=class{constructor(e,t){this.owner=e;this.repo=t}refreshTimer=null;scanTimer=null;destroyed=!1;async init(){let e=await H();if(window.location.hash==="#tasker-test-alert"&&A([{number:99999,title:"Test bounty \u2014 Bug + Daily lightning popup",url:window.location.href,labels:["Bug + Daily"]}],{sound:e.bugDailyPopupSound}),this.scanTimer=window.setTimeout(()=>{this.runScan(!0)},1500),e.autoRefreshEnabled){let t=Math.max(5,e.autoRefreshSeconds)*1e3;this.refreshTimer=window.setTimeout(()=>{this.destroyed||window.location.reload()},t)}}async runScan(e){if(!this.destroyed)try{let t=await H();await this.checkBugDailyPopup(t,e);let s=Q(t.watchedLabelGroups,t.excludedLabels),o=await I(this.owner,this.repo),r=t.notifyHelpWanted,n=s.filter(p=>!o.has(p.number));if(n.length===0)return;let l=o.size===0&&e;for(let p of n)o.add(p.number);if(await O(this.owner,this.repo,o),l||!r)return;for(let p of n.slice(0,10)){let h={type:"SEND_HELP_WANTED",owner:this.owner,repo:this.repo,number:p.number,title:p.title,url:p.url,labels:p.labels};chrome.runtime.sendMessage(h).catch(()=>{})}}catch{}}async checkBugDailyPopup(e,t){if(this.destroyed||!e.bugDailyPopupEnabled)return;let s=Q(e.watchedLabelGroups,e.excludedLabels);if(s.length===0)return;let o=await I(this.owner,this.repo,F),r=s.filter(l=>!o.has(l.number));if(r.length===0)return;let n=o.size===0&&t;for(let l of r)o.add(l.number);await O(this.owner,this.repo,o,F),!(n||this.destroyed)&&A(r,{sound:e.bugDailyPopupSound})}destroy(){this.destroyed=!0,this.refreshTimer!==null&&(clearTimeout(this.refreshTimer),this.refreshTimer=null),this.scanTimer!==null&&(clearTimeout(this.scanTimer),this.scanTimer=null)}};var w=null,L=null,_="";function ue(){return document.querySelector('[class*="sidebarContent"]')??document.querySelector(".Layout-sidebar .BorderGrid")??null}function he(){return document.querySelector('[class*="PageHeader-Description"] .d-flex.flex-justify-between')??null}function fe(){let a=document.querySelector(".js-comment-body")??document.querySelector('[data-testid="issue-body"]');if(!a)return[];let e=new Set,t=a.querySelectorAll('a[href*="/issues/"]');for(let r of t){let l=r.href.match(/\/issues\/(\d+)/);l&&e.add(parseInt(l[1],10))}let o=(a.textContent??"").matchAll(/#(\d{2,})/g);for(let r of o)e.add(parseInt(r[1],10));return Array.from(e)}function U(){let a=window.location.href;if(a===_)return;_=a,w&&(w.destroy(),w=null),L&&(L.destroy(),L=null);let e=z(a);if(e){L=new B(e.owner,e.repo),L.init();return}let t=$(a);if(!t)return;let s=(o=0)=>{if(t.type==="pr"){let r=he();if(!r){o<20&&setTimeout(()=>s(o+1),250);return}let n=fe();w=new C(t.owner,t.repo,t.number,"pr",n),r.appendChild(w.element),w.init()}else{let r=ue();if(!r){o<20&&setTimeout(()=>s(o+1),250);return}w=new C(t.owner,t.repo,t.number,"issue",[]),r.appendChild(w.element),w.init()}};s()}U();document.addEventListener("turbo:load",()=>{_="",U()});var V=window.location.href;setInterval(()=>{window.location.href!==V&&(V=window.location.href,_="",U())},1e3);chrome.runtime.onMessage.addListener(a=>{a.type==="TEST_BUG_DAILY_ALERT"&&A([{number:99999,title:"Test bounty \u2014 Bug + Daily lightning popup",url:window.location.href,labels:["Bug + Daily"]}],{sound:a.sound})});})();
