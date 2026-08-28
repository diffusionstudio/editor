// This shallow equal looks insane because it is optimized to use short circuiting
// and the least amount of evaluations possible.

export function /* @inline @pure */ shallowEqual(obj1: any, obj2: any): boolean {
  return (
    obj1 === obj2 ||
    (typeof obj1 === 'object' &&
      obj1 !== null &&
      typeof obj2 === 'object' &&
      obj2 !== null &&
      (() => {
        const keys1 = Object.keys(obj1);
        const keys2 = Object.keys(obj2);
        return (
          keys1.length === keys2.length &&
          keys1.every((key) => Object.hasOwn(obj2, key) && obj1[key] === obj2[key])
        );
      })())
  );
}
