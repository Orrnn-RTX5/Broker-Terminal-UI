import { validateBrokerRuntimeConfig, type BrokerRuntimeConfiguration } from './brokerRuntimeConfig';

type Primitive = string | number | boolean | bigint | symbol | null | undefined;
type Field = { name: string; value: Primitive | Primitive[]; enumerable: boolean; writable: boolean; configurable: boolean };
type Options = { allowLocal?: boolean; desktop?: boolean };
const ordinaryObjectNames = new Set([
  'constructor', '__defineGetter__', '__defineSetter__', 'hasOwnProperty', '__lookupGetter__',
  '__lookupSetter__', 'isPrototypeOf', 'propertyIsEnumerable', 'toString', 'valueOf', '__proto__', 'toLocaleString',
]);
const objectPrototype = Object.getOwnPropertyDescriptors(Object.prototype);
const arrayIterator = Array.prototype[Symbol.iterator];
const primitive = (value: unknown): value is Primitive => value === null
  || (typeof value !== 'object' && typeof value !== 'function');

function ordinaryPrototypeUnchanged(): boolean {
  const names = Reflect.ownKeys(Object.prototype);
  return names.length === Object.getOwnPropertyNames(objectPrototype).length
    && names.every(name => {
      if (typeof name !== 'string' || !ordinaryObjectNames.has(name)) return false;
      const before = objectPrototype[name];
      const now = Object.getOwnPropertyDescriptor(Object.prototype, name)!;
      return before && Object.is(before.value, now.value) && before.get === now.get && before.set === now.set
        && before.enumerable === now.enumerable && before.configurable === now.configurable
        && before.writable === now.writable;
    });
}

function snapshot(config: Record<string, unknown> | undefined): Field[] | null {
  if (!config || !ordinaryPrototypeUnchanged()) return null;
  const prototype = Object.getPrototypeOf(config);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const names = Reflect.ownKeys(config);
  if (names.length > 128 || names.some(name => typeof name !== 'string')) return null;
  const fields: Field[] = [];
  let remainingValues = 256;
  for (const name of names as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(config, name)!;
    if (!('value' in descriptor)) return null;
    if (!Object.is(Reflect.get(config, name), descriptor.value)) return null;
    let value: unknown = descriptor.value;
    if (Array.isArray(value)) {
      // Only this field is consumed as an array by the validator. Other
      // arrays undergo arbitrary String coercion and remain uncached.
      if (name !== 'CONFIG_ERRORS' || Object.getPrototypeOf(value) !== Array.prototype || value.length > 128
        || Array.prototype[Symbol.iterator] !== arrayIterator
        || Reflect.ownKeys(value).length !== value.length + 1) return null;
      const copy: Primitive[] = [];
      for (let index = 0; index < value.length; index++) {
        const item = Object.getOwnPropertyDescriptor(value, String(index));
        if (!item || !('value' in item) || !primitive(item.value)) return null;
        if (!Object.is(Reflect.get(value, String(index)), item.value)) return null;
        if (--remainingValues < 0 || (typeof item.value === 'string' && item.value.length > 8192)) return null;
        copy.push(item.value);
      }
      value = copy;
    } else if (!primitive(value)) return null;
    if (--remainingValues < 0 || (typeof value === 'string' && value.length > 8192)) return null;
    fields.push({ name, value: value as Primitive | Primitive[], enumerable: !!descriptor.enumerable,
      writable: !!descriptor.writable, configurable: !!descriptor.configurable });
  }
  return fields;
}

function equalFields(left: Field[], right: Field[]): boolean {
  return left.length === right.length && left.every((field, index) => {
    const other = right[index];
    if (field.name !== other.name || field.enumerable !== other.enumerable
      || field.writable !== other.writable || field.configurable !== other.configurable) return false;
    if (Array.isArray(field.value)) {
      return Array.isArray(other.value) && field.value.length === other.value.length
        && field.value.every((value, item) => Object.is(value, (other.value as Primitive[])[item]));
    }
    return !Array.isArray(other.value) && Object.is(field.value, other.value);
  });
}

const copyResult = (result: BrokerRuntimeConfiguration): BrokerRuntimeConfiguration => ({ ...result,
  errors: [...result.errors], allowedOrigins: [...result.allowedOrigins], extraDiscoveryUrls: [...result.extraDiscoveryUrls] });

/** One exact-input memo for pure validation only; ownership/credential decisions remain live. */
export function createBrokerRuntimeValidationCache(validate = validateBrokerRuntimeConfig) {
  let retained: { fields: Field[]; allowLocal: boolean | undefined; desktop: boolean | undefined;
    urlConstructor: typeof URL; result: BrokerRuntimeConfiguration } | undefined;
  return (config: Record<string, unknown> | undefined, options: Options): BrokerRuntimeConfiguration => {
    let fields: Field[] | null = null;
    try { fields = snapshot(config); } catch { /* Exotic objects retain the validator's uncached behavior. */ }
    if (fields && retained && Object.is(options.allowLocal, retained.allowLocal)
      && Object.is(options.desktop, retained.desktop) && URL === retained.urlConstructor && equalFields(fields, retained.fields)) {
      return copyResult(retained.result);
    }
    const result = validate(config, options);
    retained = fields ? { fields, allowLocal: options.allowLocal, desktop: options.desktop,
      urlConstructor: URL, result: copyResult(result) } : undefined;
    return result;
  };
}
