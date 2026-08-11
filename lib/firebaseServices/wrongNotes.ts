import { db } from '@/lib/firebase';
import {
  collection,
  doc,
  setDoc,
  getDocs,
  deleteDoc,
  onSnapshot,
} from 'firebase/firestore';
import { WrongNote } from '@/lib/types';

export const saveWrongNote = async (userId: string, wrongNote: WrongNote) => {
  const ref = doc(db, 'users', userId, 'wrongNotes', wrongNote.id);
  await setDoc(ref, wrongNote);
};

export const getWrongNotes = async (userId: string): Promise<WrongNote[]> => {
  const ref = collection(db, 'users', userId, 'wrongNotes');
  const snapshot = await getDocs(ref);
  return snapshot.docs.map(doc => doc.data() as WrongNote);
};

export const deleteWrongNote = async (userId: string, wrongNoteId: string) => {
  const ref = doc(db, 'users', userId, 'wrongNotes', wrongNoteId);
  await deleteDoc(ref);
};

export const subscribeWrongNotes = (
  userId: string,
  callback: (wrongNotes: WrongNote[]) => void
) => {
  const ref = collection(db, 'users', userId, 'wrongNotes');
  return onSnapshot(ref, snapshot => {
    const data = snapshot.docs.map(doc => doc.data() as WrongNote);
    callback(data);
  });
};
