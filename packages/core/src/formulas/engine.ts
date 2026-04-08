import { evaluate } from './evaluator'
import { parse } from './parser'
import type { ASTNode, FormulaContext, FormulaResult } from './types'

/**
 * FormulaEngine V3.5.3
 *
 * The main entry point for evaluating payroll formula expressions.
 * Formulas are parsed once and can be cached as AST nodes for re-evaluation
 * across multiple employees without re-parsing.
 *
 * Usage:
 *   const engine = new FormulaEngine()
 *
 *   // One-shot evaluation
 *   const result = await engine.evaluate('SALARIO / 30 * DIAS("TRABAJADOS")', ctx)
 *
 *   // Pre-parse for batch processing
 *   const ast = engine.compile('SI(CONCEPTO("HE") > 0, CONCEPTO("HE") * 1.5, 0)')
 *   for (const employeeCtx of contexts) {
 *     const result = await engine.evaluateAST(ast, employeeCtx)
 *   }
 */
export class FormulaEngine {
  private readonly cache = new Map<string, ASTNode>()

  /**
   * Parse a formula string into an AST.
   * Results are cached by formula string — the same formula is parsed only once.
   */
  compile(formula: string): ASTNode {
    const cached = this.cache.get(formula)
    if (cached) return cached
    const ast = parse(formula)
    this.cache.set(formula, ast)
    return ast
  }

  /**
   * Evaluate a pre-compiled AST with the given context.
   * Returns { value, error } — never throws.
   */
  async evaluateAST(ast: ASTNode, ctx: FormulaContext): Promise<FormulaResult> {
    try {
      const raw = await evaluate(ast, ctx)
      return { value: Number(raw) }
    } catch (err) {
      return {
        value: 0,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  /**
   * Parse + evaluate a formula string in one call.
   * The parsed AST is cached for subsequent calls with the same formula.
   * Returns { value, error } — never throws.
   */
  async evaluate(formula: string, ctx: FormulaContext): Promise<FormulaResult> {
    try {
      const ast = this.compile(formula)
      return this.evaluateAST(ast, ctx)
    } catch (err) {
      return {
        value: 0,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  /** Clear the compiled formula cache. */
  clearCache(): void {
    this.cache.clear()
  }

  /** Number of cached compiled formulas. */
  get cacheSize(): number {
    return this.cache.size
  }
}

/** Singleton engine instance for use across the application. */
export const formulaEngine = new FormulaEngine()
