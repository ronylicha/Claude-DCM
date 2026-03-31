'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Settings as SettingsIcon,
  Brain,
  Key,
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  Loader2,
  Star,
  Zap,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import apiClient from '@/lib/api-client';
import type { LLMProvider } from '@/lib/api-client';

// Provider card component
function ProviderCard({ provider }: { provider: LLMProvider }) {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [selectedModel, setSelectedModel] = useState(provider.default_model);
  const [setAsDefault, setSetAsDefault] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const queryClient = useQueryClient();

  const configureMutation = useMutation({
    mutationFn: () => apiClient.configureProvider(provider.provider_key, {
      api_key: apiKey,
      model: selectedModel !== provider.default_model ? selectedModel : undefined,
      set_default: setAsDefault || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['providers'] });
      setApiKey('');
      setTestResult(null);
    },
  });

  const testMutation = useMutation({
    mutationFn: () => apiClient.testProvider(provider.provider_key),
    onSuccess: (data) => setTestResult(data),
  });

  const deactivateMutation = useMutation({
    mutationFn: () => apiClient.deactivateProvider(provider.provider_key),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['providers'] }),
  });

  return (
    <div className={cn(
      'rounded-[16px] p-5',
      'bg-[var(--md-sys-color-surface-container)]',
      'border',
      provider.is_active
        ? 'border-[var(--md-sys-color-primary)]'
        : 'border-[var(--md-sys-color-outline-variant)]',
    )}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={cn(
            'flex items-center justify-center w-10 h-10 rounded-[12px]',
            provider.is_active
              ? 'bg-[var(--md-sys-color-primary-container)]'
              : 'bg-[var(--md-sys-color-surface-container-high)]',
          )}>
            <Brain className={cn('h-5 w-5',
              provider.is_active
                ? 'text-[var(--md-sys-color-on-primary-container)]'
                : 'text-[var(--md-sys-color-outline)]'
            )} />
          </div>
          <div>
            <h3 className="text-[15px] font-semibold text-[var(--md-sys-color-on-surface)]">
              {provider.display_name}
            </h3>
            <p className="text-[11px] text-[var(--md-sys-color-outline)] font-mono">
              {provider.base_url}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {provider.is_default && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[var(--md-sys-color-primary-container)] text-[var(--md-sys-color-on-primary-container)]">
              <Star className="h-3 w-3" /> Default
            </span>
          )}
          <span className={cn(
            'px-2.5 py-0.5 rounded-full text-[10px] font-medium',
            provider.is_active
              ? 'bg-[color-mix(in_srgb,var(--dcm-zone-green)_12%,transparent)] text-[var(--dcm-zone-green)]'
              : provider.has_key
                ? 'bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-outline)]'
                : 'bg-[color-mix(in_srgb,var(--dcm-zone-orange)_12%,transparent)] text-[var(--dcm-zone-orange)]',
          )}>
            {provider.is_active ? 'Active' : provider.has_key ? 'Inactive' : 'No API Key'}
          </span>
        </div>
      </div>

      {/* Models */}
      <div className="mb-4">
        <p className="text-[11px] font-medium text-[var(--md-sys-color-on-surface-variant)] mb-1.5">Models</p>
        <div className="flex flex-wrap gap-1.5">
          {provider.available_models.map((model) => (
            <span key={model} className={cn(
              'px-2 py-0.5 rounded-[6px] text-[11px] font-mono',
              model === provider.default_model
                ? 'bg-[var(--md-sys-color-primary-container)] text-[var(--md-sys-color-on-primary-container)]'
                : 'bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface-variant)]',
            )}>
              {model}
            </span>
          ))}
        </div>
      </div>

      {/* API Key input */}
      <div className="space-y-3">
        <div>
          <label className="block text-[11px] font-medium text-[var(--md-sys-color-on-surface-variant)] mb-1">
            API Key
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Key className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--md-sys-color-outline)]" />
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={provider.has_key ? 'Key saved (enter new to replace)' : 'Enter API key...'}
                className={cn(
                  'w-full pl-9 pr-9 py-2 rounded-[8px] text-[13px] font-mono',
                  'bg-[var(--md-sys-color-surface)]',
                  'border border-[var(--md-sys-color-outline-variant)]',
                  'text-[var(--md-sys-color-on-surface)]',
                  'placeholder:text-[var(--md-sys-color-outline)]',
                  'focus:outline-2 focus:outline-[var(--md-sys-color-primary)]',
                  'transition-colors duration-200',
                )}
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 cursor-pointer text-[var(--md-sys-color-outline)] hover:text-[var(--md-sys-color-on-surface)]"
                aria-label={showKey ? 'Hide key' : 'Show key'}
              >
                {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
        </div>

        {/* Model selector */}
        <div>
          <label className="block text-[11px] font-medium text-[var(--md-sys-color-on-surface-variant)] mb-1">
            Default Model
          </label>
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className={cn(
              'w-full px-3 py-2 rounded-[8px] text-[13px]',
              'bg-[var(--md-sys-color-surface)]',
              'border border-[var(--md-sys-color-outline-variant)]',
              'text-[var(--md-sys-color-on-surface)]',
              'focus:outline-2 focus:outline-[var(--md-sys-color-primary)]',
              'cursor-pointer',
            )}
          >
            {provider.available_models.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        {/* Set as default checkbox */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={setAsDefault}
            onChange={(e) => setSetAsDefault(e.target.checked)}
            className="w-4 h-4 rounded border-[var(--md-sys-color-outline-variant)] text-[var(--md-sys-color-primary)] cursor-pointer"
          />
          <span className="text-[12px] text-[var(--md-sys-color-on-surface-variant)]">
            Set as default provider for pipeline planning
          </span>
        </label>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => configureMutation.mutate()}
            disabled={!apiKey.trim() || configureMutation.isPending}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2 rounded-[8px] text-[12px] font-medium cursor-pointer',
              'bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)]',
              'hover:shadow-[var(--md-sys-elevation-1)]',
              'disabled:opacity-40 disabled:cursor-not-allowed',
              'transition-all duration-200',
            )}
          >
            {configureMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
            Save & Activate
          </button>

          {provider.is_active && (
            <button
              type="button"
              onClick={() => testMutation.mutate()}
              disabled={testMutation.isPending}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 rounded-[8px] text-[12px] font-medium cursor-pointer',
                'border border-[var(--md-sys-color-outline-variant)]',
                'text-[var(--md-sys-color-on-surface-variant)]',
                'hover:bg-[var(--md-sys-color-surface-container-high)]',
                'disabled:opacity-40 disabled:cursor-not-allowed',
                'transition-all duration-200',
              )}
            >
              {testMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              Test
            </button>
          )}

          {provider.is_active && (
            <button
              type="button"
              onClick={() => deactivateMutation.mutate()}
              disabled={deactivateMutation.isPending}
              className={cn(
                'px-3 py-2 rounded-[8px] text-[12px] font-medium cursor-pointer',
                'text-[var(--dcm-zone-red)]',
                'border border-[color-mix(in_srgb,var(--dcm-zone-red)_30%,transparent)]',
                'hover:bg-[color-mix(in_srgb,var(--dcm-zone-red)_8%,transparent)]',
                'disabled:opacity-40 disabled:cursor-not-allowed',
                'transition-all duration-200',
              )}
            >
              Deactivate
            </button>
          )}
        </div>

        {/* Test result */}
        {testResult && (
          <div className={cn(
            'flex items-center gap-2 px-3 py-2 rounded-[8px] text-[12px]',
            testResult.ok
              ? 'bg-[color-mix(in_srgb,var(--dcm-zone-green)_8%,transparent)] text-[var(--dcm-zone-green)]'
              : 'bg-[color-mix(in_srgb,var(--dcm-zone-red)_8%,transparent)] text-[var(--dcm-zone-red)]',
          )}>
            {testResult.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
            {testResult.ok ? 'Connection successful' : `Failed: ${testResult.error}`}
          </div>
        )}

        {configureMutation.error && (
          <p className="text-[11px] text-[var(--dcm-zone-red)]">
            Failed to save. Please try again.
          </p>
        )}
      </div>
    </div>
  );
}

// Main settings page
export default function SettingsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['providers'],
    queryFn: () => apiClient.getProviders(),
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className={cn(
          'flex items-center justify-center w-10 h-10 rounded-[12px]',
          'bg-[var(--md-sys-color-primary-container)]',
        )}>
          <SettingsIcon className="h-5 w-5 text-[var(--md-sys-color-on-primary-container)]" />
        </div>
        <div>
          <h1 className="text-[22px] font-semibold text-[var(--md-sys-color-on-surface)]">Settings</h1>
          <p className="text-[13px] text-[var(--md-sys-color-outline)]">Configure LLM providers for AI-powered pipeline planning</p>
        </div>
      </div>

      {/* Info banner */}
      <div className={cn(
        'flex items-start gap-3 px-4 py-3 rounded-[12px]',
        'bg-[color-mix(in_srgb,var(--md-sys-color-primary)_6%,transparent)]',
        'border border-[color-mix(in_srgb,var(--md-sys-color-primary)_15%,transparent)]',
      )}>
        <AlertCircle className="h-5 w-5 text-[var(--md-sys-color-primary)] shrink-0 mt-0.5" />
        <div>
          <p className="text-[13px] font-medium text-[var(--md-sys-color-on-surface)]">
            Configure at least one provider
          </p>
          <p className="text-[12px] text-[var(--md-sys-color-outline)] mt-0.5">
            The pipeline planner uses an LLM to generate intelligent execution plans. Add your API key for any provider below, then set it as default.
          </p>
        </div>
      </div>

      {/* Providers */}
      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-[280px] rounded-[16px] bg-[var(--md-sys-color-surface-container)] animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <div className="py-12 text-center">
          <p className="text-[14px] text-[var(--dcm-zone-red)]">Failed to load providers</p>
        </div>
      ) : (
        <div className="space-y-4">
          {data?.providers.map((provider) => (
            <ProviderCard key={provider.id} provider={provider} />
          ))}
        </div>
      )}
    </div>
  );
}
