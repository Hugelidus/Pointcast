/**
 * Content-script logic as pure DOM modules: no extension APIs here, so everything is testable
 * in jsdom. The WXT entrypoints wire startCapture to the runtime messaging.
 */
export { startCapture, type EmitCapturedEvent } from "./capture";
export { describeElement, findSource, readablePath } from "./describe";
export { COMPONENT_ATTRIBUTE, COMPONENT_REQUEST_EVENT, requestFrameworkInfo } from "./component-bridge";
export { redactPersonalText } from "./personal";
export { readStyles } from "./styles";
export { buildComposedSelector, buildSelector, type SelectorOptions, type SelectorResult } from "./selector";
export { isSensitive, sanitizeHtml, type SanitizeOptions } from "./sanitize";
export { redactUrl } from "./url";
export {
  DEFAULT_CAPTURE_OPTIONS,
  DEFAULT_DESCRIBE_OPTIONS,
  type CaptureOptions,
  type DescribeOptions,
} from "./options";
