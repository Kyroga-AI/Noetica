import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isComplexTask, featurePromptBlock } from './code-planner.js'
import type { CodeFeature, CodePlan } from './code-planner.js'

test('isComplexTask: flags task longer than 120 chars', () => {
  assert.equal(isComplexTask('x'.repeat(121)), true)
})

test('isComplexTask: flags app keyword', () => {
  assert.equal(isComplexTask('build a web app'), true)
})

test('isComplexTask: flags dashboard keyword', () => {
  assert.equal(isComplexTask('create a dashboard'), true)
})

test('isComplexTask: returns false for simple task', () => {
  assert.equal(isComplexTask('sort a list of numbers'), false)
})

const plan: CodePlan = {
  title: 'Todo App',
  techStack: 'React + FastAPI',
  setupCommands: [],
  features: [
    { id: 1, name: 'data model', description: 'SQLite schema for todos', depends: [], testHint: 'sqlite3 db.sqlite .tables' },
    { id: 2, name: 'REST API', description: 'CRUD endpoints', depends: [1], testHint: 'curl http://localhost:8000/todos' },
  ],
  aiFeatures: [],
}
const f2: CodeFeature = plan.features[1]!
const completed: CodeFeature[] = [plan.features[0]!]

test('featurePromptBlock: includes feature name and description', () => {
  const block = featurePromptBlock(f2, plan, completed)
  assert.ok(block.includes('REST API'))
  assert.ok(block.includes('CRUD endpoints'))
})

test('featurePromptBlock: includes completed features context', () => {
  const block = featurePromptBlock(f2, plan, completed)
  assert.ok(block.includes('data model'))
})

test('featurePromptBlock: includes tech stack', () => {
  const block = featurePromptBlock(f2, plan, completed)
  assert.ok(block.includes('React + FastAPI'))
})
