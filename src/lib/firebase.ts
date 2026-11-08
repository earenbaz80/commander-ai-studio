import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  GoogleAuthProvider, 
  GithubAuthProvider,
  signInWithPopup, 
  linkWithPopup,
  linkWithCredential,
  EmailAuthProvider,
  unlink,
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signOut,
  updateProfile,
  User 
} from 'firebase/auth';
import { 
  getFirestore, 
  initializeFirestore,
  Firestore,
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  getDocFromServer, 
  query, 
  where, 
  orderBy, 
  deleteDoc, 
  increment, 
  updateDoc,
  onSnapshot,
  arrayUnion,
  arrayRemove,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { ParameterConfig, PromptVersion } from '../types/studio';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
let db: Firestore;
try {
  db = firebaseConfig.firestoreDatabaseId
    ? initializeFirestore(app, {}, firebaseConfig.firestoreDatabaseId)
    : getFirestore(app);
} catch {
  db = getFirestore(app);
}
export { db };

// Test connection on boot per requirement
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration.");
    }
  }
}
testConnection();

// Error Handling helper as per skill requirements
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Authentication Functions
export const googleProvider = new GoogleAuthProvider();

// GitHub como método de acceso (distinto del conector OAuth del agente).
export const githubProvider = new GithubAuthProvider();
githubProvider.addScope('read:user');
githubProvider.addScope('user:email');

export async function signInWithGoogle() {
  try {
    // Request Workspace scopes
    googleProvider.addScope('https://www.googleapis.com/auth/drive.readonly');
    googleProvider.addScope('https://www.googleapis.com/auth/spreadsheets.readonly');
    googleProvider.addScope('https://www.googleapis.com/auth/documents.readonly');
    const result = await signInWithPopup(auth, googleProvider);
    if (result.user) {
      await syncUserProfile(result.user);
    }
    return result.user;
  } catch (error) {
    console.error("Error logging in with Google:", error);
    throw error;
  }
}

export async function signInWithGitHub() {
  try {
    const result = await signInWithPopup(auth, githubProvider);
    if (result.user) {
      await syncUserProfile(result.user);
    }
    return result.user;
  } catch (error) {
    console.error("Error logging in with GitHub:", error);
    throw error;
  }
}

/** Vincula Google a la cuenta actual sin pedir los scopes de Workspace. */
export async function linkGoogleAccount() {
  if (!auth.currentUser) throw new Error('No hay una sesión iniciada.');
  const provider = new GoogleAuthProvider();
  const result = await linkWithPopup(auth.currentUser, provider);
  await syncUserProfile(result.user);
  return result.user;
}

/** Vincula GitHub a la cuenta actual (requiere el proveedor en Firebase). */
export async function linkGitHubAccount() {
  if (!auth.currentUser) throw new Error('No hay una sesión iniciada.');
  const result = await linkWithPopup(auth.currentUser, githubProvider);
  await syncUserProfile(result.user);
  return result.user;
}

/** Añade correo/contraseña a una cuenta creada con Google o GitHub. */
export async function linkEmailPasswordAccount(email: string, password: string) {
  if (!auth.currentUser) throw new Error('No hay una sesión iniciada.');
  const credential = EmailAuthProvider.credential(email.trim(), password);
  const result = await linkWithCredential(auth.currentUser, credential);
  await syncUserProfile(result.user);
  return result.user;
}

export async function unlinkAccountProvider(providerId: string) {
  if (!auth.currentUser) throw new Error('No hay una sesión iniciada.');
  const user = await unlink(auth.currentUser, providerId);
  await syncUserProfile(user);
  return user;
}

// Helper to allow username-only authentication
function normalizeUsernameOrEmail(input: string): string {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed.includes('@')) {
    return `${trimmed}@studio.local`;
  }
  return trimmed;
}

export async function registerWithEmailPassword(usernameOrEmail: string, pass: string, name?: string) {
  try {
    const formattedEmail = normalizeUsernameOrEmail(usernameOrEmail);
    const displayName = name?.trim() || usernameOrEmail.trim().split('@')[0];
    const res = await createUserWithEmailAndPassword(auth, formattedEmail, pass);
    if (res.user) {
      await updateProfile(res.user, { displayName });
      await syncUserProfile(res.user, displayName);
    }
    return res.user;
  } catch (error: any) {
    console.error("Error registering with username/email:", error);
    throw error;
  }
}

export async function loginWithEmailPassword(usernameOrEmail: string, pass: string) {
  try {
    const formattedEmail = normalizeUsernameOrEmail(usernameOrEmail);
    const res = await signInWithEmailAndPassword(auth, formattedEmail, pass);
    if (res.user) {
      await syncUserProfile(res.user);
    }
    return res.user;
  } catch (error: any) {
    console.error("Error signing in with username/email:", error);
    throw error;
  }
}

export async function logoutUser() {
  return signOut(auth);
}

async function syncUserProfile(user: User, customName?: string) {
  const userRef = doc(db, 'users', user.uid);
  try {
    await setDoc(userRef, {
      uid: user.uid,
      displayName: customName || user.displayName || 'Usuario Commander',
      email: user.email || '',
      photoURL: user.photoURL || '',
      updatedAt: new Date().toISOString()
    }, { merge: true });
  } catch (err) {
    console.warn("User profile sync warning:", err);
  }
}

/**
 * Archiva o desarchiva un proyecto en el documento del usuario. Se usan
 * transformaciones de array para que dos equipos no se pisen al mismo tiempo.
 */
export async function setProjectArchivedRemote(
  userId: string,
  projectKeys: string[],
  archived: boolean,
): Promise<void> {
  const keys = Array.from(
    new Set(projectKeys.filter((key) => typeof key === 'string' && key.length > 0)),
  );
  if (!keys.length) return;
  const userRef = doc(db, 'users', userId);
  await setDoc(
    userRef,
    {
      archivedProjects: archived ? arrayUnion(...keys) : arrayRemove(...keys),
      archivedProjectsUpdatedAt: new Date().toISOString(),
    },
    { merge: true },
  );
}

/** Migra la lista local completa cuando la cuenta todavía no tiene el campo. */
export async function saveArchivedProjects(userId: string, projectKeys: string[]): Promise<void> {
  const keys = Array.from(
    new Set(projectKeys.filter((key) => typeof key === 'string' && key.length > 0)),
  );
  const userRef = doc(db, 'users', userId);
  await setDoc(
    userRef,
    {
      archivedProjects: keys,
      archivedProjectsUpdatedAt: new Date().toISOString(),
    },
    { merge: true },
  );
}

/** Escucha el archivo del usuario para compartirlo en tiempo real entre equipos. */
export function subscribeArchivedProjects(
  userId: string,
  onData: (projectKeys: string[] | null) => void,
  onError?: (error: Error) => void,
): () => void {
  return onSnapshot(
    doc(db, 'users', userId),
    (snapshot) => {
      const value = snapshot.data()?.archivedProjects;
      if (!Array.isArray(value)) {
        onData(null);
        return;
      }
      onData(value.filter((key): key is string => typeof key === 'string'));
    },
    (error) => onError?.(error),
  );
}

// Project Gallery Interfaces
export interface GalleryProject {
  id: string;
  title: string;
  description: string;
  systemInstruction: string;
  defaultPrompt: string;
  selectedModel: string;
  provider: string;
  temperature: number;
  topP: number;
  topK: number;
  maxOutputTokens?: number;
  tags: string[];
  authorId: string;
  authorName: string;
  authorEmail: string;
  likesCount: number;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
}

// Gallery API methods
export async function saveProjectToGallery(projectData: Omit<GalleryProject, 'id' | 'createdAt' | 'updatedAt' | 'likesCount'>) {
  if (!auth.currentUser) {
    throw new Error("Debes iniciar sesión para guardar un proyecto.");
  }
  
  const newProjRef = doc(collection(db, 'projects'));
  const newProject: GalleryProject = {
    ...projectData,
    id: newProjRef.id,
    authorId: auth.currentUser.uid,
    authorName: auth.currentUser.displayName || auth.currentUser.email || 'Anónimo',
    authorEmail: auth.currentUser.email || '',
    likesCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  try {
    await setDoc(newProjRef, newProject);
    return newProject;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `projects/${newProjRef.id}`);
    throw error;
  }
}

export async function savePromptVersion(projectId: string, parameters: ParameterConfig, title: string, note?: string) {
  if (!auth.currentUser) {
    throw new Error("Debes iniciar sesión para guardar una versión.");
  }

  const versionRef = doc(collection(db, 'projects', projectId, 'versions'));
  const versionData: PromptVersion = {
    id: versionRef.id,
    projectId,
    timestamp: new Date().toISOString(),
    parameters,
    title,
    note
  };

  try {
    await setDoc(versionRef, versionData);
    return versionData;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `projects/${projectId}/versions/${versionRef.id}`);
    throw error;
  }
}

export async function fetchPromptVersions(projectId: string): Promise<PromptVersion[]> {
  try {
    const versionsRef = collection(db, 'projects', projectId, 'versions');
    const q = query(versionsRef, orderBy('timestamp', 'desc'));
    const snapshot = await getDocs(q);
    
    const versions: PromptVersion[] = [];
    snapshot.forEach((doc) => {
      versions.push(doc.data() as PromptVersion);
    });

    return versions;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, `projects/${projectId}/versions`);
    return [];
  }
}

export async function fetchPublicProjects(): Promise<GalleryProject[]> {
  try {
    const projectsRef = collection(db, 'projects');
    const q = query(projectsRef, where('isPublic', '==', true));
    const snapshot = await getDocs(q);
    
    const projects: GalleryProject[] = [];
    snapshot.forEach((doc) => {
      projects.push(doc.data() as GalleryProject);
    });

    // Sort client-side by createdAt descending to avoid composite index requirements
    return projects.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'projects');
    return [];
  }
}

export async function fetchUserProjects(userId: string): Promise<GalleryProject[]> {
  try {
    const projectsRef = collection(db, 'projects');
    const q = query(projectsRef, where('authorId', '==', userId));
    const snapshot = await getDocs(q);
    
    const projects: GalleryProject[] = [];
    snapshot.forEach((doc) => {
      projects.push(doc.data() as GalleryProject);
    });

    return projects.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'projects');
    return [];
  }
}

export async function toggleProjectLike(projectId: string, currentUserId: string, currentlyLiked: boolean) {
  const likeRef = doc(db, 'projects', projectId, 'likes', currentUserId);
  const projectRef = doc(db, 'projects', projectId);

  try {
    if (currentlyLiked) {
      await deleteDoc(likeRef);
      await updateDoc(projectRef, { likesCount: increment(-1) });
    } else {
      await setDoc(likeRef, { projectId, userId: currentUserId, createdAt: new Date().toISOString() });
      await updateDoc(projectRef, { likesCount: increment(1) });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `projects/${projectId}/likes/${currentUserId}`);
  }
}

export async function checkIsLiked(projectId: string, userId: string): Promise<boolean> {
  try {
    const likeRef = doc(db, 'projects', projectId, 'likes', userId);
    const snap = await getDoc(likeRef);
    return snap.exists();
  } catch (_error) {
    return false;
  }
}

// -------------------------------------------------------------
// Composer Multi-File Cloud Projects
// -------------------------------------------------------------
export interface ComposerCloudProject {
  id: string;
  name: string;
  description?: string;
  files: { name: string; content: string }[];
  selectedModel: string;
  authorId: string;
  authorName: string;
  authorEmail: string;
  isPublic: boolean;
  likesCount?: number;
  createdAt: string;
  updatedAt: string;
}

export async function saveComposerProject(projectData: {
  id?: string;
  name: string;
  description?: string;
  files: { name: string; content: string }[];
  selectedModel: string;
  isPublic: boolean;
}): Promise<ComposerCloudProject> {
  if (!auth.currentUser) {
    throw new Error("Debes iniciar sesión para sincronizar el proyecto con Firestore.");
  }

  const projDocRef = projectData.id ? doc(db, 'composer_projects', projectData.id) : doc(collection(db, 'composer_projects'));
  const fullProject: ComposerCloudProject = {
    id: projDocRef.id,
    name: projectData.name,
    description: projectData.description || '',
    files: projectData.files,
    selectedModel: projectData.selectedModel,
    authorId: auth.currentUser.uid,
    authorName: auth.currentUser.displayName || auth.currentUser.email || 'Anónimo',
    authorEmail: auth.currentUser.email || '',
    isPublic: projectData.isPublic ?? false,
    likesCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  try {
    await setDoc(projDocRef, fullProject, { merge: true });
    return fullProject;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `composer_projects/${projDocRef.id}`);
    throw error;
  }
}

export async function fetchUserComposerProjects(userId: string): Promise<ComposerCloudProject[]> {
  try {
    const coll = collection(db, 'composer_projects');
    const q = query(coll, where('authorId', '==', userId));
    const snapshot = await getDocs(q);

    const list: ComposerCloudProject[] = [];
    snapshot.forEach((d) => {
      list.push(d.data() as ComposerCloudProject);
    });

    return list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'composer_projects');
    return [];
  }
}

export async function fetchPublicComposerProjects(): Promise<ComposerCloudProject[]> {
  try {
    const coll = collection(db, 'composer_projects');
    const q = query(coll, where('isPublic', '==', true));
    const snapshot = await getDocs(q);

    const list: ComposerCloudProject[] = [];
    snapshot.forEach((d) => {
      list.push(d.data() as ComposerCloudProject);
    });

    return list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'composer_projects');
    return [];
  }
}

export async function deleteComposerProject(projectId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'composer_projects', projectId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `composer_projects/${projectId}`);
    throw error;
  }
}
