/**
 * jsx-no-literals — hand-rolled gate (based on the official
 * `@eslint-react/kit` sample for `react/jsx-no-literals` semantics).
 *
 * Flags untranslated user-facing strings in JSX so the app stays
 * French-complete: JSX text children and string-literal children must go
 * through `t()`/`useT()`, and a curated set of user-facing attributes
 * (`aria-label`, `placeholder`, `title`, `alt`) must too. Styling/semantic
 * attributes (className, type, src, ...) and the allowlist are left alone.
 */
export function jsxNoLiterals(options = {}) {
  const { noStrings = false, allowedStrings = [], restrictedAttributes = [], elementOverrides = {} } = options
  const allowed = new Set(allowedStrings)
  const allowedElements = new Set(
    Object.entries(elementOverrides)
      .filter(([, over]) => over?.allowElement)
      .map(([name]) => name),
  )

  // Expression node types through which a string literal flows unchanged to
  // become rendered JSX text content (e.g. `{cond ? 'a' : 'b'}`).
  const TRANSPARENT_EXPRESSIONS = new Set([
    'ConditionalExpression',
    'LogicalExpression',
    'ParenthesizedExpression',
    'ChainExpression',
    'SequenceExpression',
    'TSAsExpression',
    'TSTypeAssertion',
    'TSNonNullExpression',
  ])

  return (context) => {
    const isAllowed = (text) => allowed.has(text) || allowed.has(text.trim())

    const inAllowedElement = (node) => {
      let current = node.parent
      while (current) {
        if (current.type === 'JSXElement') {
          const name = current.openingElement?.name?.name
          if (allowedElements.has(name)) return true
        }
        current = current.parent
      }
      return false
    }

    return {
      JSXText(node) {
        if (!node.value.trim()) return
        if (inAllowedElement(node)) return
        if (isAllowed(node.value)) return
        context.report({
          node,
          message: 'JSX text must go through t() so it can be translated (en + fr).',
        })
      },
      Literal(node) {
        if (typeof node.value !== 'string') return
        if (!noStrings) return
        // Walk up through expression wrappers (conditionals, logical ops,
        // parens, TS casts) to the JSX expression. A literal that reaches a
        // JSXExpressionContainer renders as text content; one that stops at a
        // call/object/etc. is an argument or data, not user-facing text.
        let current = node
        while (current.parent) {
          const parent = current.parent
          if (parent.type === 'JSXExpressionContainer') {
            if (parent.parent?.type !== 'JSXElement' && parent.parent?.type !== 'JSXFragment') return
            if (node.value.trim() === '') return
            if (inAllowedElement(node)) return
            if (isAllowed(node.value)) return
            context.report({
              node,
              message: 'JSX string literal must go through t() so it can be translated (en + fr).',
            })
            return
          }
          if (TRANSPARENT_EXPRESSIONS.has(parent.type)) {
            current = parent
            continue
          }
          return
        }
      },
      JSXAttribute(node) {
        if (restrictedAttributes.length === 0) return
        const name = node.name?.name ?? ''
        if (!restrictedAttributes.includes(name)) return
        const value = node.value
        if (!value || value.type !== 'Literal' || typeof value.value !== 'string') return
        if (inAllowedElement(node)) return
        if (isAllowed(value.value)) return
        context.report({
          node,
          message: `Attribute "${name}" must go through t() so it can be translated (en + fr).`,
        })
      },
    }
  }
}
