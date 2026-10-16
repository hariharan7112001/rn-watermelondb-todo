# WatermelonDB CRUD — Step-by-Step Guide

A guide to adding [WatermelonDB](https://watermelondb.dev) to this Expo Router app and doing CRUD (Create, Read, Update, Delete) on a `tasks` table.

**Project baseline:** Expo SDK 57, React Native 0.86 (New Architecture), Expo Router, TypeScript, React Compiler on, npm (`package-lock.json`).

> ⚠️ **WatermelonDB uses native code (SQLite + JSI).** It **does not run in Expo Go.** You need a development build (`npx expo run:android` / `npx expo run:ios` or `eas build --profile development`).

---

## Folder structure you'll end up with

```
src/
├── app/
│   ├── _layout.tsx          # wraps app in DatabaseProvider
│   ├── index.tsx            # list + create tasks
│   └── task/[id].tsx        # view / update / delete a task
└── db/
    ├── schema.ts            # table definitions
    ├── migrations.ts        # schema migrations
    ├── index.ts             # database instance
    ├── models/
    │   └── Task.ts          # Task model
    ├── tasks.ts             # CRUD functions
    └── hooks.ts             # reactive hooks (useTasks, useTask)
```

Only route files go in `src/app/`. Everything database-related goes in `src/db/`.

---

## Step 1 — Install packages

```bash
npx expo install @nozbe/watermelondb expo-build-properties
npm install --save-dev @babel/plugin-proposal-decorators
```

Then install an Expo config plugin for WatermelonDB. There is no official one. The most recent community plugin is:

```bash
npm install --save-dev @lovesworking/watermelondb-expo-plugin-sdk-52-plus
```

> 🔎 This plugin's README targets SDK 52–53. Before you continue, check its npm/GitHub page to see whether it supports **SDK 57**. If it doesn't, look for a newer fork, or write a small local config plugin (see [Troubleshooting](#troubleshooting)).

---

## Step 2 — Configure Babel for decorators

WatermelonDB models use decorators (`@field`, `@text`, …). Create **`babel.config.js`** in the project root:

```js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      ['@babel/plugin-proposal-decorators', { legacy: true }],
    ],
  };
};
```

`babel-preset-expo` already handles class properties and the React Compiler. Don't add `@babel/plugin-transform-class-properties` yourself.

---

## Step 3 — Enable decorators in TypeScript

Edit **`tsconfig.json`**:

```jsonc
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "experimentalDecorators": true,   // 👈 add
    "useDefineForClassFields": false, // 👈 add (fields must not overwrite decorator getters)
    "paths": {
      "@/*": ["./src/*"],
      "@/assets/*": ["./assets/*"]
    }
  },
  "include": ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts"]
}
```

---

## Step 4 — Register the config plugin in `app.json`

Add these entries to the `plugins` array. Keep `expo-router` and `expo-splash-screen` as they are:

```jsonc
"plugins": [
  "expo-router",
  ["expo-splash-screen", { /* unchanged */ }],
  "@lovesworking/watermelondb-expo-plugin-sdk-52-plus",
  [
    "expo-build-properties",
    {
      "android": {
        "packagingOptions": {
          "pickFirst": ["**/libc++_shared.so"]
        }
      }
    }
  ]
]
```

Never edit `ios/` or `android/` by hand. They are generated from this config.

---

## Step 5 — Define the schema

**`src/db/schema.ts`**

```ts
import { appSchema, tableSchema } from '@nozbe/watermelondb';

export const schema = appSchema({
  version: 1,
  tables: [
    tableSchema({
      name: 'tasks',
      columns: [
        { name: 'title', type: 'string' },
        { name: 'note', type: 'string', isOptional: true },
        { name: 'is_completed', type: 'boolean' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
  ],
});
```

Rules:
- Column names use `snake_case`. Types are `string`, `number` or `boolean` only.
- Every table gets an `id` column automatically. Don't declare it.
- `created_at` / `updated_at` are filled in automatically when you use `@readonly @date` (Step 7).

---

## Step 6 — Set up migrations

**`src/db/migrations.ts`**

```ts
import { schemaMigrations } from '@nozbe/watermelondb/Schema/migrations';

export const migrations = schemaMigrations({
  migrations: [
    // Example for later — when you add a column:
    // {
    //   toVersion: 2,
    //   steps: [
    //     addColumns({ table: 'tasks', columns: [{ name: 'priority', type: 'number' }] }),
    //   ],
    // },
  ],
});
```

> Whenever you change the schema after shipping, bump `schema.version` **and** add a migration with the same `toVersion`. If you don't, users' local data gets wiped.

---

## Step 7 — Create the model

**`src/db/models/Task.ts`**

```ts
import { Model } from '@nozbe/watermelondb';
import { field, text, date, readonly, writer } from '@nozbe/watermelondb/decorators';

export default class Task extends Model {
  static table = 'tasks';

  @text('title') title!: string;
  @text('note') note!: string | null;
  @field('is_completed') isCompleted!: boolean;
  @readonly @date('created_at') createdAt!: Date;
  @readonly @date('updated_at') updatedAt!: Date;

  // Writers = methods that change the DB. Keep mutations on the model when possible.
  @writer async toggle() {
    await this.update((t) => {
      t.isCompleted = !t.isCompleted;
    });
  }

  @writer async rename(title: string, note?: string) {
    await this.update((t) => {
      t.title = title;
      t.note = note ?? null;
    });
  }

  @writer async remove() {
    // Use markAsDeleted() instead if you'll add sync later
    await this.destroyPermanently();
  }
}
```

Decorator cheat sheet:

| Decorator | Use for |
|---|---|
| `@field('col')` | number / boolean / raw string |
| `@text('col')` | string (trims whitespace) |
| `@date('col')` | `number` column ↔ JS `Date` |
| `@readonly` | can't be set manually (`created_at`, `updated_at`) |
| `@relation` / `@children` | relationships (see [Next steps](#next-steps)) |

---

## Step 8 — Create the database instance

**`src/db/index.ts`**

```ts
import { Database } from '@nozbe/watermelondb';
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';

import { schema } from './schema';
import { migrations } from './migrations';
import Task from './models/Task';

const adapter = new SQLiteAdapter({
  schema,
  migrations,
  dbName: 'watermelon_app',
  jsi: true, // faster synchronous native bridge
  onSetUpError: (error) => {
    // DB failed to load — e.g. show an error screen or offer a reset
    console.error('WatermelonDB setup error', error);
  },
});

export const database = new Database({
  adapter,
  modelClasses: [Task],
});

export const tasksCollection = database.get<Task>('tasks');
```

---

## Step 9 — Write the CRUD functions

**`src/db/tasks.ts`**

```ts
import { Q } from '@nozbe/watermelondb';
import { database, tasksCollection } from './index';
import Task from './models/Task';

// CREATE
export async function createTask(title: string, note?: string): Promise<Task> {
  return database.write(async () => {
    return tasksCollection.create((t) => {
      t.title = title;
      t.note = note ?? null;
      t.isCompleted = false;
    });
  });
}

// READ — one-off fetches (for reactive UI use hooks.ts instead)
export function getAllTasks() {
  return tasksCollection.query(Q.sortBy('created_at', Q.desc)).fetch();
}

export function getTaskById(id: string) {
  return tasksCollection.find(id); // throws if not found
}

export function searchTasks(term: string) {
  return tasksCollection
    .query(Q.where('title', Q.like(`%${Q.sanitizeLikeString(term)}%`)))
    .fetch();
}

// UPDATE
export async function updateTask(id: string, changes: { title?: string; note?: string; isCompleted?: boolean }) {
  const task = await tasksCollection.find(id);
  await database.write(async () => {
    await task.update((t) => {
      if (changes.title !== undefined) t.title = changes.title;
      if (changes.note !== undefined) t.note = changes.note;
      if (changes.isCompleted !== undefined) t.isCompleted = changes.isCompleted;
    });
  });
}

// DELETE
export async function deleteTask(id: string) {
  const task = await tasksCollection.find(id);
  await database.write(async () => {
    await task.destroyPermanently();
  });
}

// BULK DELETE (one transaction — much faster than a loop of writes)
export async function deleteCompletedTasks() {
  await database.write(async () => {
    const done = await tasksCollection.query(Q.where('is_completed', true)).fetch();
    await database.batch(done.map((t) => t.prepareDestroyPermanently()));
  });
}
```

Key rules:
- **Every** create, update or delete must run inside `database.write(...)` or a `@writer` method.
- Use `database.batch()` to change several records at once.
- Inside a writer, don't call another writer directly. Use `this.callWriter(() => ...)` instead.

---

## Step 10 — Reactive hooks (auto-updating UI)

WatermelonDB queries are **observable**. Subscribe to them and the UI re-renders whenever the data changes, with no manual refetching.

**`src/db/hooks.ts`**

```ts
import { useEffect, useState } from 'react';
import { Q } from '@nozbe/watermelondb';
import { tasksCollection } from './index';
import Task from './models/Task';

export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    const sub = tasksCollection
      .query(Q.sortBy('created_at', Q.desc))
      .observeWithColumns(['title', 'is_completed']) // re-emit when these columns change
      .subscribe(setTasks);
    return () => sub.unsubscribe();
  }, []);

  return tasks;
}

export function useTask(id: string) {
  const [task, setTask] = useState<Task | null>(null);

  useEffect(() => {
    const sub = tasksCollection.findAndObserve(id).subscribe({
      next: setTask,
      error: () => setTask(null), // deleted / not found
    });
    return () => sub.unsubscribe();
  }, [id]);

  return task;
}
```

> `.observe()` only re-emits when records are **added or removed**. `.observeWithColumns([...])` also re-emits when those columns change. Use it for lists that show editable fields.
>
> Another option is the HOC `withObservables` from `@nozbe/watermelondb/react`. The hooks above are simpler and work well with the React Compiler.

---

## Step 11 — Provide the database to the app

**`src/app/_layout.tsx`**

```tsx
import { Stack } from 'expo-router';
import { DatabaseProvider } from '@nozbe/watermelondb/react';
import { database } from '@/db';

export default function RootLayout() {
  return (
    <DatabaseProvider database={database}>
      <Stack>
        <Stack.Screen name="index" options={{ title: 'Tasks' }} />
        <Stack.Screen name="task/[id]" options={{ title: 'Edit Task' }} />
      </Stack>
    </DatabaseProvider>
  );
}
```

`DatabaseProvider` is optional when you import `database` directly as above. It lets components call `useDatabase()`.

---

## Step 12 — List + Create screen (C, R)

**`src/app/index.tsx`**

```tsx
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Link } from 'expo-router';
import { useTasks } from '@/db/hooks';
import { createTask, deleteCompletedTasks } from '@/db/tasks';

export default function Index() {
  const tasks = useTasks();
  const [title, setTitle] = useState('');

  const onAdd = async () => {
    if (!title.trim()) return;
    await createTask(title.trim());
    setTitle('');
  };

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <TextInput
          style={styles.input}
          placeholder="New task…"
          value={title}
          onChangeText={setTitle}
          onSubmitEditing={onAdd}
        />
        <Pressable style={styles.button} onPress={onAdd}>
          <Text style={styles.buttonText}>Add</Text>
        </Pressable>
      </View>

      <FlatList
        data={tasks}
        keyExtractor={(t) => t.id}
        renderItem={({ item }) => (
          <View style={styles.item}>
            <Pressable onPress={() => item.toggle()}>
              <Text style={styles.check}>{item.isCompleted ? '☑' : '☐'}</Text>
            </Pressable>
            <Link href={{ pathname: '/task/[id]', params: { id: item.id } }} style={{ flex: 1 }}>
              <Text style={[styles.title, item.isCompleted && styles.done]}>{item.title}</Text>
            </Link>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No tasks yet</Text>}
      />

      <Pressable onPress={deleteCompletedTasks}>
        <Text style={styles.clear}>Clear completed</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  row: { flexDirection: 'row', gap: 8 },
  input: { flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 12, height: 44 },
  button: { backgroundColor: '#208AEF', borderRadius: 8, paddingHorizontal: 16, justifyContent: 'center' },
  buttonText: { color: '#fff', fontWeight: '600' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#ddd' },
  check: { fontSize: 22 },
  title: { fontSize: 16 },
  done: { textDecorationLine: 'line-through', color: '#999' },
  empty: { textAlign: 'center', color: '#999', marginTop: 32 },
  clear: { textAlign: 'center', color: '#d33', padding: 12 },
});
```

---

## Step 13 — Detail screen (R, U, D)

**`src/app/task/[id].tsx`**

```tsx
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTask } from '@/db/hooks';
import { deleteTask, updateTask } from '@/db/tasks';

export default function TaskDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const task = useTask(id);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setNote(task.note ?? '');
    }
  }, [task]);

  if (!task) return <Text style={{ padding: 16 }}>Task not found</Text>;

  const onSave = async () => {
    await updateTask(id, { title: title.trim(), note });
    router.back();
  };

  const onDelete = () =>
    Alert.alert('Delete task?', task.title, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteTask(id);
          router.back();
        },
      },
    ]);

  return (
    <View style={styles.container}>
      <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Title" />
      <TextInput
        style={[styles.input, { height: 120 }]}
        value={note}
        onChangeText={setNote}
        placeholder="Note"
        multiline
      />
      <Text style={styles.meta}>Created {task.createdAt.toLocaleString()}</Text>
      <Pressable style={styles.save} onPress={onSave}>
        <Text style={styles.saveText}>Save</Text>
      </Pressable>
      <Pressable onPress={onDelete}>
        <Text style={styles.delete}>Delete task</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, textAlignVertical: 'top' },
  meta: { color: '#888', fontSize: 12 },
  save: { backgroundColor: '#208AEF', borderRadius: 8, padding: 14, alignItems: 'center' },
  saveText: { color: '#fff', fontWeight: '600' },
  delete: { color: '#d33', textAlign: 'center', padding: 12 },
});
```

---

## Step 14 — Build & run (development build)

```bash
npx expo prebuild --clean     # generates ios/ & android/ with the plugin applied
npx expo run:android          # or: npx expo run:ios
```

Or in the cloud:

```bash
npx eas-cli@latest build --profile development --platform android
```

After the first native build, `npx expo start` works for JS-only changes. Rebuild whenever you change native config or plugins.

---

## Step 15 — Verify

```bash
npx expo lint
npx tsc --noEmit
npx expo-doctor
```

Manual test checklist:
- [ ] Add a task → it appears at the top of the list (Create)
- [ ] Kill and relaunch the app → tasks are still there (persistence)
- [ ] Tap the checkbox → strike-through updates instantly (Update + reactivity)
- [ ] Open a task, edit the title, save → the list shows the new title (Update)
- [ ] Delete a task → it disappears from the list (Delete)
- [ ] "Clear completed" removes all checked tasks (batch delete)

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `Cannot read property 'xxx' of undefined` / native module null | You're in **Expo Go**, or you haven't rebuilt since adding the plugin. Run `npx expo prebuild --clean` and then `run:android/ios`. |
| Fields are always `undefined` | Decorator config is wrong. Check `babel.config.js` (`legacy: true`), `experimentalDecorators` and `useDefineForClassFields: false`, then restart Metro with `npx expo start -c`. |
| `Diagnostic error: Cannot create/update/delete outside a Writer` | Wrap the mutation in `database.write(...)` or a `@writer` method. |
| Android: `More than one file was found with OS independent path 'lib/.../libc++_shared.so'` | The `pickFirst` option in `expo-build-properties` (Step 4) is missing. |
| iOS build error mentioning `simdjson` | Add `simdjson` as an extra pod through `expo-build-properties` → `ios.extraPods`, following the plugin's README. |
| Plugin doesn't support SDK 57 | Fork it or write a local plugin (`plugins/withWatermelonDB.js`) that adds the JSI package on Android (`WatermelonDBJSIPackage`) and the `simdjson` pod on iOS. Alternatively, set `jsi: false` in the adapter as a temporary workaround (slower, but has fewer native requirements). |
| List doesn't update after an edit | Use `.observeWithColumns([...])` instead of `.observe()`. |
| Web | WatermelonDB on web needs `LokiJSAdapter` instead of SQLite. Create `src/db/index.web.ts` with that adapter if you need web support. |

---

## Next steps

- **Relations:** add a `projects` table, then use `@relation('projects', 'project_id')` on Task and `@children('tasks')` on Project, with `static associations`.
- **Sync with a backend:** `synchronize()` from `@nozbe/watermelondb/sync` with `pullChanges` / `pushChanges`. When you use sync, delete records with `markAsDeleted()` instead of `destroyPermanently()`.
- **Seeding / bulk import:** `database.batch(...items.map(i => collection.prepareCreate(...)))`.
- **Reference docs:** https://watermelondb.dev/docs
