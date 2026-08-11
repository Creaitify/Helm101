import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/react'

// StudioView reveals variants on a 1000ms setTimeout, which is exactly
// Testing Library's default findBy*/waitFor timeout — under load the assertion
// and the timer race, making the studio tests flaky. Give async utilities
// headroom over the longest timer the UI schedules.
configure({ asyncUtilTimeout: 5000 })
