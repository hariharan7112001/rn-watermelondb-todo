import { useEffect, useState } from 'react';
import { Button, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Todo, addTodo, deleteTodo, editTodo, toggleTodo, watchTodos } from '@/db';

export default function Index() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<Todo | null>(null);

  // Keep the list in sync with the database
  useEffect(() => {
    const subscription = watchTodos(setTodos);
    return () => subscription.unsubscribe();
  }, []);

  const save = async () => {
    if (!text.trim()) return;
    if (editing) await editTodo(editing, text.trim());
    else await addTodo(text.trim());
    setText('');
    setEditing(null);
  };

  const startEdit = (todo: Todo) => {
    setEditing(todo);
    setText(todo.title);
  };

  return (
    <SafeAreaView style={styles.screen}>
      <Text style={styles.heading}>My Todos</Text>

      <View style={styles.row}>
        <TextInput
          style={styles.input}
          placeholder="What do you need to do?"
          value={text}
          onChangeText={setText}
          onSubmitEditing={save}
        />
        <Button title={editing ? 'Save' : 'Add'} onPress={save} />
      </View>

      <FlatList
        data={todos}
        keyExtractor={(todo) => todo.id}
        ListEmptyComponent={<Text style={styles.empty}>Nothing to do 🎉</Text>}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Pressable style={styles.todo} onPress={() => toggleTodo(item)}>
              <Text style={[styles.title, item.done && styles.done]}>
                {item.done ? '✅' : '⬜'} {item.title}
              </Text>
            </Pressable>
            <Button title="Edit" onPress={() => startEdit(item)} />
            <Button title="Delete" color="red" onPress={() => deleteTodo(item)} />
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16 },
  heading: { fontSize: 28, fontWeight: 'bold', marginBottom: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  input: { flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10 },
  todo: { flex: 1 },
  title: { fontSize: 18 },
  done: { textDecorationLine: 'line-through', color: 'gray' },
  empty: { textAlign: 'center', color: 'gray', marginTop: 40 },
});
