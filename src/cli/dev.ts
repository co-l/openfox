#!/usr/bin/env node
import { runCli } from './main.js'
runCli({ mode: 'development' }).catch(console.error)
