/**
 * Template provider implementations
 */

export { FilesystemTemplateProvider } from './filesystem-template-provider';
export type { FilesystemTemplateProviderOptions } from './filesystem-template-provider';

export {
  ReactEmailTemplateProvider,
  createReactEmailProvider,
} from './react-email-provider';
export type { ReactEmailTemplate, ReactEmailProviderConfig } from './react-email-provider';
