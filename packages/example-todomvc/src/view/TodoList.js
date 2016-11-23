import { merge } from 'most'
import { subject } from 'most-subject'

import { streamDom } from '../stream-dom'
import { findSelectorTarget } from './findSelectorTarget'
import * as actions from '../model/todo-actions'

export function TodoList({ todos$ }) {
  const editingId$ = subject()

  const todoUi = ({ id, text, completed = false }) => {
    const classes$ = editingId$.map(editingId => [ 'todo' ].concat(
      id === editingId ? 'editing' : [],
      completed ? 'completed' : []
    ).join(' '))

    return component(h => (
      <li id={id} class={classes$}>
        <div class="view">
          <input class="toggle" type="checkbox" checked={completed} />
          <label>{ text }</label>,
          <button class="destroy" />
        </div>
        <input class="edit" value={text} />
      </li>
    ))
  }

  return component(
    h => <ul node-name="root">{ todos$.map(todos => todos.map(todoUi)) }</ul>,
    nodes => {
      const { root } = nodes

      const findTodoSelectorTarget = findSelectorTarget('.todo')

      const beginEdit$ = root.events.dblclick
        .filter(e => e.target.matches('.todo label'))
        .filter(findTodoSelectorTarget)

      const editFieldKeyDown$ = root.events.keydown
        .filter(e => e.target.matches('.edit'))
        .filter(findTodoSelectorTarget)
        .multicast()

      const commitEdit$ = editFieldKeyDown$
        .filter(e => e.key === 'Enter')
        .multicast()

      const abortEdit$ = merge(
        editFieldKeyDown$.filter(e => e.key === 'Escape'),
        root.events.captureBlur.filter(e => e.target.matches('.edit'))
      )

      merge(
        beginEdit$.map(e => e.selectorTarget.id),
        merge(commitEdit$, abortEdit$).constant(null)
      )
      .skipRepeats()
      .observe(editingId => {
        editingId$.next(editingId)

        if (editingId !== null) {
          const inputNode = document.querySelector(`#${editingId} .edit`)
          inputNode.focus()
          inputNode.selectionStart = inputNode.value.length
        }
      })

      return {
        edit$: commitEdit$.map(e => {
          const { id } = e.selectorTarget
          const trimmedText = e.target.value.trim()
          return trimmedText.length === 0 ? actions.destroy(id) : actions.edit(id, trimmedText)
        }),
        toggle$: root.events.change
          .filter(e => e.target.matches('.toggle'))
          .filter(findTodoSelectorTarget)
          .map(e => actions.toggle(e.selectorTarget.id, e.target.checked)),
        destroy$: root.events.click
          .filter(findTodoSelectorTarget)
          .filter(e => e.target.matches('.destroy'))
          .map(e => actions.destroy(e.selectorTarget.id))
      }
    }
  )
}

