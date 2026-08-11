import { db } from '@/lib/firebase';
import {
  collection,
  doc,
  setDoc,
  getDocs,
  deleteDoc,
  onSnapshot,
} from 'firebase/firestore';
import { Question } from '@/lib/types';

export const saveQuestion = async (userId: string, question: Question) => {
  const ref = doc(db, 'users', userId, 'questions', question.id);
  await setDoc(ref, question);
};

export const getQuestions = async (userId: string): Promise<Question[]> => {
  const ref = collection(db, 'users', userId, 'questions');
  const snapshot = await getDocs(ref);
  return snapshot.docs.map(doc => doc.data() as Question);
};

export const deleteQuestion = async (userId: string, questionId: string) => {
  const ref = doc(db, 'users', userId, 'questions', questionId);
  await deleteDoc(ref);
};

export const subscribeQuestions = (
  userId: string,
  callback: (questions: Question[]) => void
) => {
  const ref = collection(db, 'users', userId, 'questions');
  return onSnapshot(ref, snapshot => {
    const data = snapshot.docs.map(doc => doc.data() as Question);
    callback(data);
  });
};
