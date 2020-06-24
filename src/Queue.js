// @flow

/**
 * A queue utility class.
 */
export default class Queue<T> {

    _elements: Array<T>;

    /**
     * Creates a new Queue instance.
     *
     * @param {Array<*>} [elements] - Optional array of elements that will be used for initialization.
     */
    constructor(elements: Array<T> = []) {
        this._elements = elements;
    }

    /**
     * Adds new element to the tail of the queue.
     *
     * @param {*} element - The new element to be added.
     * @returns {void}
     */
    push(element: T) {
        this._elements.push(element);
    }

    /**
     * Returns an element at a specific index in the queue.
     *
     * @param {number} index - The index of the element in the queue.
     * @returns {*} - The requested element.
     */
    getAt(index: number): ?T {
        if (index >= this.size) {
            return undefined;
        }

        return this._elements[index];
    }

    /**
     * Returns the first element in the queue.
     *
     * @returns {*} - The first element.
     */
    get head(): T {
        return this._elements[0];
    }

    /**
     * Checks if there's a specific element already in the queue.
     *
     * @param {*} element - The element we are looking for.
     * @returns {boolean} - True if the element is in the queue and false otherwise.
     */
    has(element: T): boolean {
        return this.find(element) !== -1;
    }

    /**
     * Returns the index of the element in the queue.
     *
     * @param {*} element - The element we are looking for.
     * @returns {number} - The index of the element in the queue or -1 if the element wasn't found.
     */
    find(element: T): number {
        return this._elements.findIndex(e => e === element);
    }

    /**
     * Removes element from the queue.
     *
     * @param {*} element - The element to be removed.
     * @returns {number|undefined} - The index of the removed element or undefined if nothing was removed.
     */
    remove(element: T): ?number {
        const index = this.find(element);

        if (index === -1) {
            return undefined;
        }

        const removedItem = this.removeAt(index);

        return typeof removedItem === 'undefined' ? undefined : index;
    }

    /**
     * Removes an element in a specific index.
     *
     * @param {number} index - The index.
     * @returns {*} - The removed element or undefined if nothing was removed.
     */
    removeAt(index: number): ?T {
        const removedItems = this._elements.splice(index, 1);

        return removedItems.length === 0 ? undefined : removedItems[0];
    }

    /**
     * Returns the size of the queue.
     *
     * @returns {number} - The size of the queue.
     */
    get size(): number {
        return this._elements.length;
    }
}
