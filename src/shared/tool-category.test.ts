import { describe, it, expect } from 'vitest'
import { classifyTool, TOOL_CATEGORY_ORDER } from './tool-category.js'

describe('classifyTool', () => {
  it('classifies read tools', () => {
    expect(classifyTool('read_file')).toBe('read')
    expect(classifyTool('glob')).toBe('read')
    expect(classifyTool('grep')).toBe('read')
  })

  it('classifies search tools', () => {
    expect(classifyTool('web_fetch')).toBe('search')
    expect(classifyTool('web_search')).toBe('search')
  })

  it('classifies edit tools', () => {
    expect(classifyTool('write_file')).toBe('edit')
    expect(classifyTool('edit_file')).toBe('edit')
  })

  it('classifies shell tools', () => {
    expect(classifyTool('run_command')).toBe('shell')
    expect(classifyTool('shell_tail')).toBe('shell')
  })

  it('classifies sub-agent tool', () => {
    expect(classifyTool('call_sub_agent')).toBe('sub-agent')
  })

  it('classifies MCP tools by prefix', () => {
    expect(classifyTool('mcp__server_tool')).toBe('mcp')
    expect(classifyTool('mcp__fs_read')).toBe('mcp')
  })

  it('classifies test tools by prefix', () => {
    expect(classifyTool('test_run')).toBe('test')
    expect(classifyTool('run_test_suite')).toBe('test')
    expect(classifyTool('pytest_helper')).toBe('test')
    expect(classifyTool('jest_runner')).toBe('test')
  })

  it('classifies git tools by prefix', () => {
    expect(classifyTool('git_status')).toBe('git')
    expect(classifyTool('git_diff')).toBe('git')
  })

  it('classifies browser tools by prefix', () => {
    expect(classifyTool('browser_navigate')).toBe('browser')
    expect(classifyTool('playwright_click')).toBe('browser')
    expect(classifyTool('puppeteer_open')).toBe('browser')
  })

  it('falls back to other for unknown tools', () => {
    expect(classifyTool('ask_user')).toBe('other')
    expect(classifyTool('session_metadata')).toBe('other')
    expect(classifyTool('mcp_config')).toBe('other')
    expect(classifyTool('load_skill')).toBe('other')
    expect(classifyTool('step_done')).toBe('other')
    expect(classifyTool('return_value')).toBe('other')
  })

  it('handles empty input', () => {
    expect(classifyTool('')).toBe('other')
  })

  it('exposes a stable category order', () => {
    expect(TOOL_CATEGORY_ORDER).toEqual([
      'read',
      'search',
      'edit',
      'shell',
      'test',
      'git',
      'browser',
      'mcp',
      'sub-agent',
      'other',
    ])
  })
})
