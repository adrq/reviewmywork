import { assertEquals, assertExists } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { BUILD_INFO, isDeno, isVSCode, VERSION } from '../../src/core/version.ts';

Deno.test('VERSION constant should be defined', () => {
  assertExists(VERSION);
  assertEquals(typeof VERSION, 'string');
});

Deno.test('VERSION should follow semantic versioning pattern', () => {
  const semverPattern = /^\d+\.\d+\.\d+$/;
  assertEquals(semverPattern.test(VERSION), true);
});

Deno.test('BUILD_INFO should contain required fields', () => {
  assertExists(BUILD_INFO);
  assertEquals(typeof BUILD_INFO.version, 'string');
  assertEquals(typeof BUILD_INFO.target, 'string');
  assertEquals(typeof BUILD_INFO.timestamp, 'string');
  assertEquals(BUILD_INFO.version, VERSION);
});

Deno.test("BUILD_INFO target should be 'deno' in test environment", () => {
  assertEquals(BUILD_INFO.target, 'deno');
});

Deno.test('isDeno function should return true in Deno environment', () => {
  assertEquals(isDeno(), true);
});

Deno.test('isVSCode function should return false in test environment', () => {
  assertEquals(isVSCode(), false);
});

Deno.test('BUILD_INFO timestamp should be valid ISO string', () => {
  const timestamp = new Date(BUILD_INFO.timestamp);
  assertEquals(timestamp instanceof Date, true);
  assertEquals(isNaN(timestamp.getTime()), false);
});
