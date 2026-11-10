import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// jsdom does not implement scrollIntoView, which the grid calls when the keyboard moves.
Element.prototype.scrollIntoView = () => undefined

afterEach(cleanup)
