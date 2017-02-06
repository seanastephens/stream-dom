import { merge } from 'most'
import { sync } from 'most-subject'

import { DoublyLinkedList, Node as ListNode } from './doubly-linked-list'

import { NodeDescriptor } from './node'
import { createNodeDescriptors } from './node-helpers'
import { toArray } from 'kind'

function createStreamNode (manageContent, scope, input$) {
  const { document } = scope
  const domStartNode = document.createComment(``)
  const domEndNode = document.createComment(``)

  const content$ = manageContent(scope, domStartNode, domEndNode, input$)
    .until(scope.destroy$)
    .multicast()
  content$.drain()

  return new StreamNodeDescriptor(
    scope.sharedRange, domStartNode, domEndNode, content$
  )
}

export function createReplacementNode (scope, input$) {
  return createStreamNode(replaceOnContentEvent, scope, input$)

  function replaceOnContentEvent (scope, domStartNode, domEndNode, children$) {
    return children$.map(toArray).map(children => {
      const childScope = Object.assign({}, scope, {
        destroy$: merge(children$, scope.destroy$).take(1).multicast()
      })
      return createNodeDescriptors(childScope, children)
    })
    .tap(childDescriptors => {
      const { document, sharedRange } = scope

      const fragment = document.createDocumentFragment()
      childDescriptors.forEach(childDescriptor => childDescriptor.insert(fragment))

      sharedRange.setStartAfter(domStartNode)
      sharedRange.setEndBefore(domEndNode)
      sharedRange.deleteContents()
      sharedRange.insertNode(fragment)
    })
  }
}

export function createOrderedListNode (scope, {
  getKey,
  renderItemStream,
  list$
}) {
  return createStreamNode(updateListOnContentEvent, scope, list$)

  function updateListOnContentEvent (scope, domStartNode, domEndNode, list$) {
    const parentDestroy$ = scope.destroy$
    const update$ = list$.map(itemList => {
      const itemMap = itemList.reduce(
        (map, item) => map.set(getKey(item), item),
        // TODO: Consider eliminating use of Map
        new Map()
      )
      return { itemList, itemMap }
    })
    const itemMap$ = update$.map(update => update.itemMap).multicast()

    // TODO: Address high complexity and re-enable complexity rule
    // eslint-disable-next-line complexity
    // TODO: Investigate improved patching strategy
    return update$.scan((nodeState, update) => {
      const { nodeList, nodeMap } = nodeState
      const { itemList, itemMap } = update

      let currentListNode = nodeList.head()
      // TODO: Treat itemList as an Iterable, not an Array
      let i = 0
      while (i < itemList.length) {
        const removeCurrentListNode = !!currentListNode && itemMap.has(currentListNode.value.key)
        if (removeCurrentListNode) {
          const nodeToDestroy = currentListNode
          currentListNode = currentListNode.next
          destroyListNode(itemList, itemMap, nodeToDestroy)
        } else {
          const item = itemList[i]
          const itemKey = getKey(item)

          if (nodeMap.has(itemKey)) {
            const itemListNode = nodeMap.get(itemKey)

            if (itemListNode.key === currentListNode.key) {
              currentListNode = currentListNode.next
            } else {
              moveListNode(nodeList, itemListNode, currentListNode)
            }
          } else {
            createListNode(nodeList, nodeMap, itemMap$, itemKey, currentListNode)
          }

          ++i
        }
      }

      // We have passed all nodes associated with existing items,
      // so the remaining nodes should be removed
      for (; currentListNode !== null; currentListNode = currentListNode.next) {
        destroyListNode(nodeList, nodeMap, currentListNode)
      }

      return { nodeList, nodeMap }
    }, {
      nodeList: new DoublyLinkedList(),
      nodeMap: new Map()
    })

    function createListNode (nodeList, listNodeMap, itemMap$, itemKey, beforeListNode) {
      const itemDestroy$ = sync()
      const declaration = renderItemStream(itemMap$.map(
        itemMap => itemMap.has(itemKey) ? itemMap.get(itemKey) : null
      ))
      const itemScope = Object.assign({}, scope, {
        destroy$: merge(parentDestroy$, itemDestroy$).take(1).multicast()
      })
      const newListNode = new ListNode({
        key: itemKey,
        descriptor: declaration.create(itemScope),
        itemDestroy$
      })

      moveListNode(nodeList, newListNode, beforeListNode)
      listNodeMap.set(newListNode.value.key, newListNode)
    }

    function destroyListNode (nodeList, listNodeMap, listNode) {
      const { value } = listNode
      nodeList.remove(listNode)
      listNodeMap.delete(value.key)
      value.itemDestroy$.next()
      value.descriptor.remove()
    }

    function moveListNode (nodeList, listNode, beforeListNode) {
      nodeList.insertBefore(listNode, beforeListNode)

      const { descriptor } = listNode.value
      const parentNode = domEndNode.parentNode
      const beforeNode = beforeListNode ? beforeListNode.value.descriptor : domEndNode
      descriptor.insert(parentNode, beforeNode)
    }
  }
}

export class StreamNodeDescriptor extends NodeDescriptor {
  get type () { return `stream` }

  constructor (sharedRange, domStartNode, domEndNode, childDescriptors$) {
    super()

    this.sharedRange = sharedRange
    this.domStartNode = domStartNode
    this.domEndNode = domEndNode
    this.childDescriptors$ = childDescriptors$
  }

  extractContents () {
    const { domStartNode, domEndNode } = this

    if (domStartNode.parentNode === null) {
      const fragment = document.createDocumentFragment()
      fragment.appendChild(domStartNode)
      fragment.appendChild(domEndNode)
      return fragment
    } else {
      const { sharedRange } = this
      sharedRange.setStartBefore(domStartNode)
      sharedRange.setStartAfter(domEndNode)
      return sharedRange.extractContents()
    }
  }

  deleteContents () {
    if (this.domStartNode.parentNode !== null) {
      const { sharedRange } = this
      sharedRange.setStartBefore(this.domStartNode)
      sharedRange.setEndAfter(this.domEndNode)
      sharedRange.deleteContents()
    }
  }

  getBeforeNode () {
    return this.domStartNode
  }
}