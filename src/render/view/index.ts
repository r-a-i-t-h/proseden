export type {
  Channel,
  Control,
  EditorKind,
  LinkListItem,
  MetaPart,
  Node,
  PageView,
  StatListItem,
  TextRenderOptions,
} from "./types.js";
export { isPageView } from "./types.js";
export * from "./factories.js";
export * from "./examples.js";
export { toHtml, userLink } from "./toHtml.js";
export { toText, renderPageText } from "./toText.js";
export function formatPlainMessage(title: string, message: string): string {
  return `[${title}]\n\n${message}\n`;
}
export { scenePageView, entityDetailView } from "./pages/scene.js";
export { artefactPageView } from "./pages/artefact.js";
export { profilePageView, backCrumb } from "./pages/profile.js";
export type { PageBackLink } from "./pages/profile.js";
export { msgPageView } from "./pages/msg.js";
export { inboxPageView } from "./pages/inbox.js";
export { dashboardPageView } from "./pages/dashboard.js";
export type { DashboardOverviewCounts, DashboardProcess } from "./pages/dashboard.js";
export { messagePageView, viewLockdownPageView } from "./pages/message.js";
export { accessForm, transferForm } from "./pages/access.js";
export { jsonFileEditorPageView } from "./pages/json-editor.js";
export { groupsIndexPageView, groupPageView } from "./pages/groups.js";
export type { GroupListItem } from "./pages/groups.js";
export { inventoryPageView } from "./pages/inventory.js";
export { userProfilePageView } from "./pages/user-profile.js";
export { staffPageView } from "./pages/staff.js";
export { editHistoryPageView, snapshotPageView } from "./pages/history.js";
export { adminDataPageView, adminQuestsIndexPageView } from "./pages/admin.js";
export { liveAdminPageView } from "./pages/live-admin.js";
export type {
  LiveAdminBuffer,
  LiveAdminSecurity,
  LiveAdminUser,
} from "./pages/live-admin.js";
export { editorBackCrumb } from "./pages/json-editor.js";
