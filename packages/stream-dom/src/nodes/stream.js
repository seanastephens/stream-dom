import { merge } from 'most'
import create from 'lodash.create'

import { initializeChildren } from './util/initializeChildren'

export function stream(context, children$) {
  return (scope) => {
    const { document } = context
    const { destroy$ } = scope
    const domStartNode = document.createComment('')
    const domEndNode = document.createComment('')

    const childDescriptors$ = children$
      .until(destroy$)
      .map(children => initializeChildren(children, create(scope, {
        destroy$: merge(children$, destroy$).take(1),
      })))
      .tap(childDescriptors => {
        const { document, sharedRange } = context

        const fragment = document.createDocumentFragment()
        childDescriptors.forEach(childDescriptor => childDescriptor.insert(fragment))

        sharedRange.setStartAfter(domStartNode)
        sharedRange.setEndBefore(domEndNode)
        sharedRange.deleteContents()
        sharedRange.insertNode(fragment)
      })

    childDescriptors$.drain()

    return new StreamNodeDescriptor({
      sharedRange: context.sharedRange,
      domStartNode,
      domEndNode,
      childDescriptors$
    })
  }
}

class StreamNodeDescriptor {
  get type() { return 'stream' }

  constructor({ sharedRange, domStartNode, domEndNode, childDescriptors$ }) {
    this.sharedRange = sharedRange
    this.domStartNode = domStartNode
    this.domEndNode = domEndNode
    this.childDescriptors$ = childDescriptors$
  }

  insert(domParentNode, domBeforeNode = null) {
    domParentNode.insertBefore(this.domStartNode, domBeforeNode)
    domParentNode.insertBefore(this.domEndNode, domBeforeNode)
  }
  remove() {
    const { sharedRange } = this
    sharedRange.setStartBefore(this.domStartNode)
    sharedRange.setEndAfter(this.domEndNode)
    sharedRange.deleteContents()
  }
}
