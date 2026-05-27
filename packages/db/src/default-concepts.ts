/**
 * Conceptos por defecto que toda empresa nueva tiene que tener listos
 * para liquidar la primera planilla. Se siembran:
 *
 *   - Desde `provisionTenant` (packages/db/src/provisioning.ts) cuando
 *     un super-admin crea una empresa por la wizard.
 *   - Desde `seed.ts` cuando se ejecuta el seed de desarrollo, para
 *     mantener paridad con el flujo de producción.
 *
 * Si necesitás cambiar fórmulas o agregar conceptos, tocás este array;
 * las dos rutas se mantienen sincronizadas.
 *
 * Las fórmulas siguen la convención del motor de cálculo del API:
 *   SALARIO, GASTOS_REPRESENTACION son variables del empleado.
 *   CONCEPTO("CODE") referencia el resultado de otro concepto.
 *   SI(cond, then, else) es el operador condicional del DSL.
 */

export type DefaultConcept = {
  code: string
  name: string
  type: 'income' | 'deduction' | 'patronal'
  formula: string
  unit: 'amount' | 'hours' | 'percentage' | 'days'
  printDetails: boolean
  prorates: boolean
  allowModify: boolean
  isReferenceValue: boolean
  useAmountCalc: boolean
  allowZero: boolean
  /**
   * Si se proveen, el concepto solo entra en planillas cuya frecuencia
   * (`payrolls.frequency`) coincide con uno de estos códigos. Vacío =
   * el concepto se procesa en cualquier frecuencia.
   */
  frequencyCodes?: string[]
  /**
   * Idem para el tipo de planilla (`payrolls.type`). Útil para
   * conceptos como XIII_MES que solo deben entrar en planillas
   * `thirteenth` y nunca en regulares.
   */
  payrollTypeCodes?: string[]
}

/**
 * Fórmula del XIII Mes (Decimotercer Mes) panameño.
 *
 * Convención: 1/12 del total devengado por el empleado en el cuatrimestre
 * que cubre cada pago (Dec 16 → Apr 15, Apr 16 → Aug 15, Aug 16 → Dec 15).
 * Los códigos del primer argumento de ACUMULADOS son los `concept_code`
 * que las planillas regulares depositan en `payroll_acumulados`. Si el
 * tenant no tiene alguno de ellos, ACUMULADOS() devuelve 0 sin romper.
 *
 * `dias_trabajados` se preserva como variable informativa para el
 * operador (no afecta el monto). El motor toma `INIPERIODO` y
 * `FINPERIODO` de la cabecera de la planilla XIII, que el endpoint
 * `POST /payroll/thirteenth` ya calcula vía `determinarPeriodoTrimestral`.
 */
const XIII_MES_FORMULA = [
  'dias_trabajados = ANTIGUEDAD_DIAS',
  'acumulados = ACUMULADOS("SUELDO,HORAS_EXTRAS,COMISIONES,BONIFICACIONES", FICHA, INIPERIODO, FINPERIODO)',
  'monto = acumulados/12',
].join('\n')

const ISLR_FORMULA = [
  'salario_anual = SALARIO*13',
  'gr_anual = GASTOS_REPRESENTACION*13',
  '',
  'neto_gravable = salario_anual',
  'saldo_gravable = SI(neto_gravable>11000, neto_gravable-11000, 0)',
  'isr_anual = saldo_gravable * 0.15',
  'isr_mensual = isr_anual/13',
  'isr_quincenal = isr_mensual/2',
  '',
  'saldo_excedente = SI(salario_anual>50000, salario_anual-50000, 0)',
  'excendente_gravable = SI(saldo_excedente>0, saldo_excedente*0.25, 0)',
  'exceso_adicional = SI(excendente_gravable>0, excendente_gravable+5850, 0)',
  'exceso_anual = SI(exceso_adicional>0, exceso_adicional/13, 0)',
  'exceso_quincenal = SI(exceso_anual>0, exceso_anual/2, 0)',
  'monto = SI(saldo_excedente>0, exceso_quincenal, isr_quincenal)',
].join('\n')

export const DEFAULT_CONCEPTS: DefaultConcept[] = [
  {
    code: 'HORAS_EXTRAS',
    name: 'Horas Extras',
    type: 'income',
    formula: '',
    unit: 'amount',
    printDetails: true,
    prorates: false,
    allowModify: true,
    isReferenceValue: false,
    useAmountCalc: true,
    allowZero: false,
  },
  {
    code: 'COMISIONES',
    name: 'Comisiones',
    type: 'income',
    formula: '',
    unit: 'amount',
    printDetails: true,
    prorates: false,
    allowModify: true,
    isReferenceValue: false,
    useAmountCalc: true,
    allowZero: false,
  },
  {
    code: 'BONIFICACIONES',
    name: 'Bonificaciones',
    type: 'income',
    formula: '',
    unit: 'amount',
    printDetails: true,
    prorates: false,
    allowModify: true,
    isReferenceValue: false,
    useAmountCalc: true,
    allowZero: false,
  },
  {
    code: 'XIII_MES',
    name: 'Decimotercer Mes',
    type: 'income',
    formula: XIII_MES_FORMULA,
    unit: 'amount',
    printDetails: true,
    prorates: false,
    allowModify: false,
    isReferenceValue: false,
    useAmountCalc: false,
    allowZero: false,
    // Solo se procesa cuando la planilla tiene type=thirteenth y
    // frequency=thirteenth — el motor filtra vía concept_*_links.
    payrollTypeCodes: ['thirteenth'],
    frequencyCodes: ['thirteenth'],
  },
  {
    code: 'ISLR',
    name: 'IMPUESTO SOBRE LA RENTA',
    type: 'deduction',
    formula: ISLR_FORMULA,
    unit: 'amount',
    printDetails: true,
    prorates: false,
    allowModify: false,
    isReferenceValue: false,
    useAmountCalc: true,
    allowZero: false,
  },
  {
    code: 'SUELDO',
    name: 'Sueldo',
    type: 'income',
    formula: 'SALARIO*0.5',
    unit: 'amount',
    printDetails: false,
    prorates: false,
    allowModify: false,
    isReferenceValue: false,
    useAmountCalc: false,
    allowZero: false,
  },
  {
    code: 'SS',
    name: 'Seguro Social',
    type: 'deduction',
    formula: 'CONCEPTO("SUELDO")*0.095',
    unit: 'amount',
    printDetails: true,
    prorates: false,
    allowModify: false,
    isReferenceValue: false,
    useAmountCalc: true,
    allowZero: true,
  },
  {
    code: 'SE',
    name: 'Seguro Educativo',
    type: 'deduction',
    formula: 'CONCEPTO("SUELDO")*0.0975',
    unit: 'amount',
    printDetails: true,
    prorates: false,
    allowModify: false,
    isReferenceValue: false,
    useAmountCalc: true,
    allowZero: false,
  },
  {
    code: 'SSP',
    name: 'Seguro Social Patronal',
    type: 'deduction',
    formula: 'CONCEPTO("SUELDO")*0.1325',
    unit: 'amount',
    printDetails: false,
    prorates: false,
    allowModify: false,
    isReferenceValue: false,
    useAmountCalc: false,
    allowZero: false,
  },
  {
    code: 'SEP',
    name: 'Seguro Educativo Patronal',
    type: 'deduction',
    formula: 'CONCEPTO("SUELDO")*0.015',
    unit: 'amount',
    printDetails: false,
    prorates: false,
    allowModify: false,
    isReferenceValue: false,
    useAmountCalc: false,
    allowZero: false,
  },
]
