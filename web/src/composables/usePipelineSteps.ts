import { reactive, computed } from 'vue'

export interface PipelineStepDef {
  key: string
  label: string
}

export function usePipelineSteps(steps: PipelineStepDef[]) {
  const stepValues = reactive<Record<string, boolean>>({})

  function reset() {
    for (const step of steps) {
      stepValues[step.key] = true
    }
  }
  reset()

  /** Handle sequential constraint: checking a step enables all prior steps;
   *  unchecking a step disables all subsequent steps. */
  function onStepChange(key: string) {
    const idx = steps.findIndex(s => s.key === key)
    if (idx === -1) return

    if (stepValues[key]) {
      // Just enabled → enable all prior steps
      for (let j = 0; j < idx; j++) {
        stepValues[steps[j].key] = true
      }
    } else {
      // Just disabled → disable all subsequent steps
      for (let j = idx + 1; j < steps.length; j++) {
        stepValues[steps[j].key] = false
      }
    }
  }

  const allSelected = computed(() => steps.every(s => stepValues[s.key]))

  function getSelectedSteps(): string[] {
    return steps.filter(s => stepValues[s.key]).map(s => s.key)
  }

  function getStepFlags(): Record<string, boolean> {
    const flags: Record<string, boolean> = {}
    for (const step of steps) {
      flags[step.key] = stepValues[step.key]
    }
    return flags
  }

  function toggleAll() {
    const newVal = !allSelected.value
    for (const step of steps) {
      stepValues[step.key] = newVal
    }
  }

  // Return as reactive so computed refs (allSelected) are auto-unwrapped in templates
  return reactive({ stepValues, allSelected, onStepChange, getSelectedSteps, getStepFlags, toggleAll, reset })
}
