/** Presentation compatibility for reports saved before condition labels were translated. */
const labels: Record<string, string> = {
  shift_calendar: '班次日历',
  material_availability: '物料可用性',
  staffing: '人员配置',
  mold_maintenance: '模具维护状态',
  physical_mold_occupancy: '模具占用情况',
  changeover_duration: '换型时长',
  physical_mold_compatibility: '模具兼容性',
};

export function productionConditionLimitation(text: string): string {
  const label = Object.hasOwn(labels, text) ? labels[text] : undefined;
  return label ? `尚未核验的生产条件：${label}；执行前需人工确认。` : text;
}

export function limitationHint(code: string, hint: string): string {
  return code === 'EXPLANATION_PARTIAL' && hint === '补充所缺证据后重新解释。'
    ? '请根据上述限制核实适用条件，执行前由计划员确认。'
    : hint;
}
