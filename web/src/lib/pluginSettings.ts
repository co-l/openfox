export type PluginSettingFieldType = 'text' | 'password' | 'number' | 'boolean' | 'select' | 'textarea'

export interface PluginSettingOption {
  label: string
  value: string
}

export interface PluginSettingField {
  key: string
  label: string
  type: PluginSettingFieldType
  description?: string
  defaultValue?: string | number | boolean
  options?: PluginSettingOption[]
  placeholder?: string
  required?: boolean
}

export interface PluginSettingsSpec {
  title?: string
  description?: string
  fields?: PluginSettingField[]
  customUiUrl?: string
}
