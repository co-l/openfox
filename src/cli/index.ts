#!/usr/bin/env node
import { runCli } from './main.js'
runCli({ mode: 'production' }).catch(console.error)
