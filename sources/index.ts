import type { Plugin } from '@yarnpkg/core'

import { LicensesReportCommand } from './commands/licensesReport'

const plugin: Plugin = {
  commands: [LicensesReportCommand],
}

export default plugin
