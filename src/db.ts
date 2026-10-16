import { Database, Model, appSchema, tableSchema } from '@nozbe/watermelondb';
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';
import { field, text } from '@nozbe/watermelondb/decorators';

// 1. The SHAPE of our data: a "todos" table with two columns.
const schema = appSchema({
  version: 1,
  tables: [
    tableSchema({
      name: 'todos',
      columns: [
        { name: 'title', type: 'string' },
        { name: 'done', type: 'boolean' },
      ],
    }),
  ],
});

// 2. One Todo = one row in the "todos" table.
export class Todo extends Model {
  static table = 'todos';

  @text('title') title!: string;
  @field('done') done!: boolean;
}

// 3. The database itself, saved on the phone with SQLite.
export const database = new Database({
  adapter: new SQLiteAdapter({ schema, jsi: true }),
  modelClasses: [Todo],
});

const todos = database.get<Todo>('todos');

// 4. CRUD. Every change must happen inside database.write().

// Create
export const addTodo = (title: string) =>
  database.write(() =>
    todos.create((todo) => {
      todo.title = title;
      todo.done = false;
    })
  );

// Read (live: the callback runs again every time the list changes)
export const watchTodos = (onChange: (list: Todo[]) => void) =>
  todos.query().observeWithColumns(['title', 'done']).subscribe(onChange);

// Update
export const editTodo = (todo: Todo, title: string) =>
  database.write(() => todo.update((t) => { t.title = title; }));

export const toggleTodo = (todo: Todo) =>
  database.write(() => todo.update((t) => { t.done = !t.done; }));

// Delete
export const deleteTodo = (todo: Todo) =>
  database.write(() => todo.destroyPermanently());
