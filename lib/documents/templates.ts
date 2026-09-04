/**
 * Starting documents.
 *
 * Each is the HTML the editor stores — headings, paragraphs, lists, the
 * blocks this editor has — written in the subject's own vocabulary rather
 * than as placeholders: the meeting minutes template asks the questions a
 * meeting has to answer. A template is text; adding one is adding text.
 */

export interface DocumentTemplate {
  id: string;
  label: string;
  hint: string;
  html: string;
}

export const DOCUMENT_TEMPLATES: DocumentTemplate[] = [
  {
    id: "meeting-minutes",
    label: "Meeting minutes",
    hint: "Attendees, agenda, decisions, actions.",
    html: `<h1>Meeting minutes</h1>
<p><strong>Date:</strong> &nbsp; <strong>Attendees:</strong> </p>
<h2>Agenda</h2>
<ol><li><p>Item</p></li><li><p>Item</p></li></ol>
<h2>Decisions</h2>
<ul><li><p>What was decided, and by whom.</p></li></ul>
<h2>Actions</h2>
<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Who · what · by when</p></li></ul>
<h2>Open questions</h2>
<ul><li><p></p></li></ul>`,
  },
  {
    id: "project-brief",
    label: "Project brief",
    hint: "Goal, scope, timeline, risks, people.",
    html: `<h1>Project brief</h1>
<nav data-toc="true"></nav>
<h2>Goal</h2><p>What done looks like, in one paragraph.</p>
<h2>Scope</h2><div data-columns="true" data-count="2"><div data-column="true"><p><strong>In</strong></p><ul><li><p></p></li></ul></div><div data-column="true"><p><strong>Out</strong></p><ul><li><p></p></li></ul></div></div>
<h2>Timeline</h2><table><tbody><tr><th><p>Milestone</p></th><th><p>Date</p></th><th><p>Owner</p></th></tr><tr><td><p>Kick-off</p></td><td><p></p></td><td><p></p></td></tr><tr><td><p>First review</p></td><td><p></p></td><td><p></p></td></tr><tr><td><p>Launch</p></td><td><p></p></td><td><p></p></td></tr></tbody></table>
<h2>Risks</h2><div data-callout="true" data-tone="warning"><p>What could slip, and what we depend on.</p></div>
<h2>People</h2><p>Owner, reviewers, who needs to know.</p>`,
  },
  {
    id: "one-pager",
    label: "One-pager",
    hint: "Problem, proposal, evidence, ask.",
    html: `<h1>One-pager</h1>
<h2>The problem</h2><p>Who has it, how often, what it costs.</p>
<h2>The proposal</h2><p>What we would do, in plain words.</p>
<h2>Evidence</h2><ul><li><p></p></li></ul>
<h2>What we are asking for</h2><div data-callout="true" data-tone="info"><p>The decision, the budget, or the time.</p></div>`,
  },
  {
    id: "sop",
    label: "Procedure (SOP)",
    hint: "Purpose, scope, steps, checks.",
    html: `<h1>Standard operating procedure</h1>
<p><strong>Owner:</strong> &nbsp; <strong>Version:</strong> 1.0 &nbsp; <strong>Last reviewed:</strong> </p>
<h2>Purpose</h2><p></p>
<h2>Scope</h2><p>Where this applies and where it does not.</p>
<h2>Steps</h2><ol><li><p></p></li><li><p></p></li><li><p></p></li></ol>
<h2>Checks</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul>
<div data-callout="true" data-tone="note"><p>Who to ask when a step cannot be followed.</p></div>`,
  },
  {
    id: "letter",
    label: "Letter",
    hint: "Addresses, date, salutation, sign-off.",
    html: `<p>Your name<br>Your address</p>
<p>${new Date().toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}</p>
<p>Recipient<br>Their address</p>
<p>Dear ,</p>
<p></p>
<p>Yours sincerely,</p>
<p></p>`,
  },
  {
    id: "weekly-update",
    label: "Weekly update",
    hint: "Done, next, blocked, numbers.",
    html: `<h1>Weekly update</h1>
<h2>Done this week</h2><ul><li><p></p></li></ul>
<h2>Next week</h2><ul><li><p></p></li></ul>
<h2>Blocked</h2><div data-callout="true" data-tone="warning"><p>What is stuck, and who can unstick it.</p></div>
<h2>Numbers</h2><table><tbody><tr><th><p>Measure</p></th><th><p>This week</p></th><th><p>Last week</p></th></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td></tr></tbody></table>`,
  },
];
