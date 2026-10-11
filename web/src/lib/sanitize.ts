import DOMPurify from 'dompurify'
import type { Config } from 'dompurify'

const SVG_CONFIG: Config = {
  USE_PROFILES: { svg: true, svgFilters: true },
  ADD_TAGS: ['svg'],
  ADD_ATTR: ['viewBox', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'data-testid'],
  FORBID_TAGS: [
    'script',
    'foreignObject',
    'use',
    'iframe',
    'embed',
    'object',
    'a',
    'image',
    'animate',
    'set',
    'handler',
  ],
  FORBID_ATTR: ['href', 'xlink:href', 'src', 'onload', 'onerror', 'onclick', 'onmouseover'],
  ALLOW_DATA_ATTR: false,
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
  RETURN_TRUSTED_TYPE: false,
}

const HTML_CONFIG: Config = {
  ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'code', 'pre', 'br', 'p', 'ul', 'ol', 'li', 'span'],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'class'],
  ALLOW_DATA_ATTR: false,
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
  RETURN_TRUSTED_TYPE: false,
}

export function sanitizeSvg(svg: string): string {
  if (!svg || typeof svg !== 'string') return ''
  return DOMPurify.sanitize(svg, SVG_CONFIG)
}

export function sanitizeHtml(html: string): string {
  if (!html || typeof html !== 'string') return ''
  return DOMPurify.sanitize(html, HTML_CONFIG)
}

const DANGEROUS_SVG_PATTERNS = [
  /<script/i,
  /\son\w+\s*=/i,
  /javascript:/i,
  /<foreignObject/i,
  /<iframe/i,
  /<embed/i,
  /<object/i,
  /<use\s/i,
  /xlink:href/i,
  /data:text\/html/i,
]

export function isSafeSvg(svg: string): boolean {
  if (!svg || typeof svg !== 'string') return false
  return !DANGEROUS_SVG_PATTERNS.some((pattern) => pattern.test(svg))
}
