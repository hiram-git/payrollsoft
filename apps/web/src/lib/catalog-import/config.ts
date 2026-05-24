/**
 * Definiciones de los catálogos importables. Cada entrada describe:
 *
 *   - label: nombre humano para el UI
 *   - apiPath: ruta POST del backend (ej. '/job-titles')
 *   - required/optional: columnas del Excel con sus aliases
 *   - dependencies: catálogos que se pre-fetchean para resolver
 *     códigos a UUIDs (ej. estructura necesita cargos/funciones)
 *   - sampleRow: fila de ejemplo para la plantilla
 *   - permission: permiso requerido para importar
 *   - returnPath: URL de vuelta al listado
 *
 * El importador y el generador de template usan esta estructura
 * para funcionar genéricamente con cualquier catálogo sin código
 * duplicado — agregar un catálogo nuevo es sólo agregar una entrada.
 */

export type ColumnDef = {
  key: string
  label: string
  aliases?: string[]
  maxLength?: number
}

export type CatalogConfig = {
  label: string
  apiPath: string
  required: ColumnDef[]
  optional: ColumnDef[]
  dependencies: string[]
  sampleRow: Record<string, string | number>
  permission: string
  returnPath: string
}

export const CATALOG_CONFIGS: Record<string, CatalogConfig> = {
  cargos: {
    label: 'Cargos',
    apiPath: '/job-titles',
    required: [
      { key: 'code', label: 'Código', aliases: ['codigo', 'cod'], maxLength: 20 },
      { key: 'name', label: 'Nombre', aliases: ['nombre'], maxLength: 255 },
    ],
    optional: [
      {
        key: 'description',
        label: 'Descripción',
        aliases: ['descripcion', 'desc'],
        maxLength: 500,
      },
    ],
    dependencies: [],
    sampleRow: { code: 'GER', name: 'Gerente', description: 'Cargo gerencial' },
    permission: 'catalogs:create',
    returnPath: '/config/job-titles',
  },

  funciones: {
    label: 'Funciones',
    apiPath: '/job-functions',
    required: [
      { key: 'code', label: 'Código', aliases: ['codigo', 'cod'], maxLength: 20 },
      { key: 'name', label: 'Nombre', aliases: ['nombre'], maxLength: 255 },
    ],
    optional: [
      {
        key: 'description',
        label: 'Descripción',
        aliases: ['descripcion', 'desc'],
        maxLength: 500,
      },
    ],
    dependencies: [],
    sampleRow: { code: 'ADM', name: 'Administrativo', description: 'Funciones administrativas' },
    permission: 'catalogs:create',
    returnPath: '/config/job-functions',
  },

  departamentos: {
    label: 'Departamentos',
    apiPath: '/departments',
    required: [
      { key: 'code', label: 'Código', aliases: ['codigo', 'cod'], maxLength: 20 },
      { key: 'name', label: 'Nombre', aliases: ['nombre'], maxLength: 255 },
    ],
    optional: [
      {
        key: 'parentCode',
        label: 'Código del departamento padre',
        aliases: ['padre', 'parent', 'parent_code', 'departamento_padre'],
      },
    ],
    dependencies: ['departamentos'],
    sampleRow: { code: 'FIN', name: 'Finanzas', parentCode: '' },
    permission: 'catalogs:create',
    returnPath: '/config/departments',
  },

  partidas: {
    label: 'Partidas presupuestarias',
    apiPath: '/budget-items',
    required: [
      { key: 'code', label: 'Código', aliases: ['codigo', 'cod'], maxLength: 20 },
      { key: 'name', label: 'Nombre', aliases: ['nombre'], maxLength: 255 },
    ],
    optional: [],
    dependencies: [],
    sampleRow: { code: '001', name: 'Salarios del personal fijo' },
    permission: 'catalogs:create',
    returnPath: '/config/budget-items',
  },

  estructura: {
    label: 'Posiciones (estructura)',
    apiPath: '/positions',
    required: [
      { key: 'code', label: 'Código', aliases: ['codigo', 'cod'], maxLength: 20 },
      { key: 'name', label: 'Nombre', aliases: ['nombre', 'posicion', 'puesto'], maxLength: 255 },
      { key: 'salary', label: 'Salario', aliases: ['sueldo', 'salario_base'] },
    ],
    optional: [
      {
        key: 'cargoCode',
        label: 'Código de cargo',
        aliases: ['cargo', 'cargo_code', 'cod_cargo'],
      },
      {
        key: 'funcionCode',
        label: 'Código de función',
        aliases: ['funcion', 'funcion_code', 'cod_funcion'],
      },
      {
        key: 'departamentoCode',
        label: 'Código de departamento',
        aliases: ['departamento', 'depto', 'depto_code', 'cod_depto'],
      },
      {
        key: 'partidaCode',
        label: 'Código de partida',
        aliases: ['partida', 'partida_code', 'cod_partida'],
      },
    ],
    dependencies: ['cargos', 'funciones', 'departamentos', 'partidas'],
    sampleRow: {
      code: 'P001',
      name: 'Analista contable',
      salary: '1500.00',
      cargoCode: 'ANA',
      funcionCode: 'ADM',
      departamentoCode: 'FIN',
      partidaCode: '001',
    },
    permission: 'positions:create',
    returnPath: '/config/estructura',
  },

  acreedores: {
    label: 'Acreedores',
    apiPath: '/creditors',
    required: [
      { key: 'code', label: 'Código', aliases: ['codigo', 'cod'], maxLength: 20 },
      { key: 'name', label: 'Nombre', aliases: ['nombre', 'razon_social'], maxLength: 255 },
    ],
    optional: [{ key: 'description', label: 'Descripción', aliases: ['descripcion', 'desc'] }],
    dependencies: [],
    sampleRow: { code: 'CSS', name: 'Caja de Seguro Social', description: 'Cuota obrero-patronal' },
    permission: 'creditors:create',
    returnPath: '/config/acreedores',
  },
}

export function getCatalogConfig(type: string): CatalogConfig | null {
  return CATALOG_CONFIGS[type] ?? null
}

export function canonicalKey(raw: string, config: CatalogConfig): string | null {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
  const allCols = [...config.required, ...config.optional]
  for (const col of allCols) {
    if (col.key.toLowerCase() === normalized) return col.key
    if (col.label.toLowerCase().replace(/[\s_-]+/g, '') === normalized) return col.key
    if (col.aliases?.some((a) => a.toLowerCase().replace(/[\s_-]+/g, '') === normalized)) {
      return col.key
    }
  }
  return null
}
