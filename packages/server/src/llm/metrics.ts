import type { VllmMetrics } from '@openfox/shared'
import { logger } from '../utils/logger.js'

export async function fetchVllmMetrics(baseUrl: string): Promise<VllmMetrics | null> {
  try {
    // vLLM exposes metrics at /metrics (Prometheus format)
    // The base URL includes /v1, so we need to go up a level
    const metricsUrl = baseUrl.replace(/\/v1\/?$/, '/metrics')
    
    const response = await fetch(metricsUrl, {
      signal: AbortSignal.timeout(5000),
    })
    
    if (!response.ok) {
      logger.warn('Failed to fetch vLLM metrics', { status: response.status })
      return null
    }
    
    const text = await response.text()
    return parsePrometheusMetrics(text)
  } catch (error) {
    logger.debug('Could not fetch vLLM metrics', { error })
    return null
  }
}

function parsePrometheusMetrics(text: string): VllmMetrics {
  const metrics: VllmMetrics = {
    numRequestsRunning: 0,
    numRequestsWaiting: 0,
    timeToFirstTokenSeconds: 0,
    timePerOutputTokenSeconds: 0,
    e2eRequestLatencySeconds: 0,
    promptTokensTotal: 0,
    generationTokensTotal: 0,
    gpuCacheUsagePercent: 0,
    cpuCacheUsagePercent: 0,
    numPreemptionsTotal: 0,
  }
  
  const lines = text.split('\n')
  
  for (const line of lines) {
    if (line.startsWith('#') || !line.trim()) continue
    
    // Parse metric line: metric_name{labels} value
    const match = line.match(/^([a-z_:]+)(?:\{[^}]*\})?\s+(.+)$/)
    if (!match) continue
    
    const [, name, valueStr] = match
    const value = parseFloat(valueStr!)
    
    if (isNaN(value)) continue
    
    switch (name) {
      case 'vllm:num_requests_running':
        metrics.numRequestsRunning = value
        break
      case 'vllm:num_requests_waiting':
        metrics.numRequestsWaiting = value
        break
      case 'vllm:time_to_first_token_seconds_sum':
        // This is a histogram, we'd need count to get average
        // For simplicity, just use the sum as an approximation
        metrics.timeToFirstTokenSeconds = value
        break
      case 'vllm:time_per_output_token_seconds_sum':
        metrics.timePerOutputTokenSeconds = value
        break
      case 'vllm:e2e_request_latency_seconds_sum':
        metrics.e2eRequestLatencySeconds = value
        break
      case 'vllm:prompt_tokens_total':
        metrics.promptTokensTotal = value
        break
      case 'vllm:generation_tokens_total':
        metrics.generationTokensTotal = value
        break
      case 'vllm:gpu_cache_usage_perc':
        metrics.gpuCacheUsagePercent = value * 100
        break
      case 'vllm:cpu_cache_usage_perc':
        metrics.cpuCacheUsagePercent = value * 100
        break
      case 'vllm:num_preemptions_total':
        metrics.numPreemptionsTotal = value
        break
    }
  }
  
  return metrics
}

export function deriveMetrics(
  raw: VllmMetrics,
  contextUsage: { current: number; max: number }
): {
  prefillSpeed: number
  generationSpeed: number
  contextPercent: number
  cacheHealth: 'good' | 'pressure' | 'critical'
} {
  return {
    prefillSpeed: raw.timeToFirstTokenSeconds > 0 
      ? Math.round(raw.promptTokensTotal / raw.timeToFirstTokenSeconds) 
      : 0,
    generationSpeed: raw.timePerOutputTokenSeconds > 0 
      ? Math.round(1 / raw.timePerOutputTokenSeconds) 
      : 0,
    contextPercent: Math.round((contextUsage.current / contextUsage.max) * 100),
    cacheHealth: raw.gpuCacheUsagePercent > 95 
      ? 'critical' 
      : raw.gpuCacheUsagePercent > 80 
        ? 'pressure' 
        : 'good',
  }
}
