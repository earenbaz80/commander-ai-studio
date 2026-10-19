/**
 * Stores Index - Combined provider and exports
 */
import { ReactNode } from 'react';
import { ChatStoreProvider } from './chatStore';
import { UIStoreProvider } from './uiStore';
import { TabsStoreProvider } from './tabsStore';
import { AuthStoreProvider } from './authStore';

interface AppStoreProviderProps {
  children: ReactNode;
  initialProjectPath?: string;
}

export function AppStoreProvider({ children, initialProjectPath = '' }: AppStoreProviderProps) {
  return (
    <AuthStoreProvider>
      <ChatStoreProvider>
        <UIStoreProvider>
          <TabsStoreProvider initialProjectPath={initialProjectPath}>
            {children}
          </TabsStoreProvider>
        </UIStoreProvider>
      </ChatStoreProvider>
    </AuthStoreProvider>
  );
}

// Re-export stores
export { ChatStoreProvider, useChatStore, useChatState, useChatActions } from './chatStore';
export type { ChatState } from './chatStore';

export { UIStoreProvider, useUIStore, useUIState, useUIActions } from './uiStore';
export type { UIState } from './uiStore';

export { TabsStoreProvider, useTabsStore, useTabsState, useTabsActions, useActiveTab } from './tabsStore';
export type { TabsState } from './tabsStore';

export { AuthStoreProvider, useAuthStore, useAuthState, useAuthActions, useDisplayName, useIsAuthenticated } from './authStore';
export type { AuthState } from './authStore';

// Re-export aiProviders
export {
  detectProvider,
  buildProviderPayload,
  getEndpointWithHost,
  modelSupportsTools,
  getDefaultModelForProvider,
  PROVIDER_CONFIGS,
} from '../lib/aiProviders';
export type { ProviderPayload, ProviderConfig } from '../lib/aiProviders';