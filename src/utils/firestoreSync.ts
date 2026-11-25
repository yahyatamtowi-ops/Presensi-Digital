import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type Unsubscribe,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import type {
  AttendanceRecord,
  DayOfWeek,
  LateCorrectionRequest,
  MasterSubject,
  SchoolSettings,
  SemesterKind,
  Student,
  SubjectAssignment,
  SubjectAttendanceRecord,
  TeacherSchedule,
  UserAccount,
} from '../types';
import {
  attendanceDocId,
  buildAttendancePayload,
  buildLateCorrectionRequestPayload,
  buildMasterSubjectPayload,
  buildSchoolConfigCreatePayload,
  buildSchoolConfigUpdatePayload,
  buildStudentPayload,
  buildSubjectAssignmentPayload,
  buildSubjectRecordPayload,
  buildTeacherSchedulePayload,
  buildUserAccountPayload,
  extractSchoolSettingsFromDoc,
  lateCorrectionDocId,
  studentDocId,
  toSafeFirestoreDocId,
} from './firestorePayloads';
import { normalizeAttendanceStatus } from './attendanceLogic';
import { recordFirestoreOps } from './firestoreUsage';

export interface FullLocalSchoolSnapshot {
  settings: SchoolSettings;
  students: Student[];
  records: AttendanceRecord[];
  masterSubjects: MasterSubject[];
  teacherSchedules: TeacherSchedule[];
  subjectAssignments: SubjectAssignment[];
  subjectRecords: SubjectAttendanceRecord[];
  accounts: UserAccount[];
  lateCorrectionRequests?: LateCorrectionRequest[];
}

export interface WorkspaceSubscriptionCallbacks {
  getFallbackSettings: () => SchoolSettings;
  onSettings: (settings: SchoolSettings) => void;
  onStudents: (students: Student[]) => void;
  onRecords: (records: AttendanceRecord[]) => void;
  onMasterSubjects: (subjects: MasterSubject[]) => void;
  onTeacherSchedules: (schedules: TeacherSchedule[]) => void;
  onSubjectAssignments: (assignments: SubjectAssignment[]) => void;
  onSubjectRecords: (records: SubjectAttendanceRecord[]) => void;
  onAccounts: (accounts: UserAccount[]) => void;
  onLateCorrectionRequests?: (requests: LateCorrectionRequest[]) => void;
  onSyncActivity: () => void;
  onError: (err: unknown, path: string) => void;
}

const BATCH_LIMIT = 350;

async function commitBatchedWrites(
  ops: Array<{ pathSegments: [string, ...string[]]; data: DocumentData }>
) {
  for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
    const chunk = ops.slice(i, i + BATCH_LIMIT);
    const batch = writeBatch(db);
    for (const item of chunk) {
      batch.set(doc(db, ...item.pathSegments), item.data);
    }
    await batch.commit();
    recordFirestoreOps({ writes: chunk.length });
  }
}

async function deleteAllInSubcollection(uid: string, subName: string) {
  const path = `schools/${uid}/${subName}`;
  try {
    const q = query(collection(db, 'schools', uid, subName), where('ownerId', '==', uid));
    const snap = await getDocs(q);
    recordFirestoreOps({ reads: Math.max(1, snap.size) });
    if (snap.empty) return;
    const docs = snap.docs;
    for (let i = 0; i < docs.length; i += BATCH_LIMIT) {
      const chunk = docs.slice(i, i + BATCH_LIMIT);
      const batch = writeBatch(db);
      for (const d of chunk) {
        batch.delete(d.ref);
      }
      await batch.commit();
      recordFirestoreOps({ deletes: chunk.length });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

/**
 * Ensures the root `/schools/{uid}` workspace document exists before subcollection writes.
 * If this is a brand-new cloud workspace, uploads the current local data automatically.
 */
export async function ensureSchoolWorkspaceExists(
  uid: string,
  localSnapshot: FullLocalSchoolSnapshot
): Promise<{ createdNew: boolean }> {
  const schoolPath = `schools/${uid}`;
  const schoolRef = doc(db, 'schools', uid);
  try {
    const existing = await getDoc(schoolRef);
    recordFirestoreOps({ reads: 1 });
    if (existing.exists()) {
      return { createdNew: false };
    }
    // Create parent workspace doc FIRST so subcollection security rules pass `isSchoolOwner(schoolId)`
    await setDoc(
      schoolRef,
      buildSchoolConfigCreatePayload(uid, localSnapshot.settings, serverTimestamp())
    );
    recordFirestoreOps({ writes: 1 });
    await pushSubcollectionsToCloud(uid, localSnapshot);
    return { createdNew: true };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, schoolPath);
  }
}

async function pushSubcollectionsToCloud(
  uid: string,
  snapshot: FullLocalSchoolSnapshot
): Promise<void> {
  const ops: Array<{ pathSegments: [string, ...string[]]; data: DocumentData }> = [];

  for (const s of snapshot.students) {
    ops.push({
      pathSegments: ['schools', uid, 'students', studentDocId(s)],
      data: buildStudentPayload(uid, s, serverTimestamp()),
    });
  }
  for (const r of snapshot.records) {
    ops.push({
      pathSegments: ['schools', uid, 'attendance', attendanceDocId(r)],
      data: buildAttendancePayload(uid, r, serverTimestamp()),
    });
  }
  for (const subj of snapshot.masterSubjects) {
    ops.push({
      pathSegments: ['schools', uid, 'subjects', toSafeFirestoreDocId(subj.id, 'subj')],
      data: buildMasterSubjectPayload(uid, subj, serverTimestamp()),
    });
  }
  for (const sch of snapshot.teacherSchedules) {
    ops.push({
      pathSegments: ['schools', uid, 'schedules', toSafeFirestoreDocId(sch.id, 'sch')],
      data: buildTeacherSchedulePayload(uid, sch, serverTimestamp()),
    });
  }
  for (const asg of snapshot.subjectAssignments) {
    ops.push({
      pathSegments: [
        'schools',
        uid,
        'subjectAssignments',
        toSafeFirestoreDocId(asg.id, 'asg'),
      ],
      data: buildSubjectAssignmentPayload(uid, asg, serverTimestamp()),
    });
  }
  for (const srec of snapshot.subjectRecords) {
    ops.push({
      pathSegments: [
        'schools',
        uid,
        'subjectRecords',
        toSafeFirestoreDocId(srec.id, 'srec'),
      ],
      data: buildSubjectRecordPayload(uid, srec, serverTimestamp()),
    });
  }
  for (const acc of snapshot.accounts) {
    ops.push({
      pathSegments: ['schools', uid, 'accounts', toSafeFirestoreDocId(acc.id, 'usr')],
      data: buildUserAccountPayload(uid, acc, serverTimestamp()),
    });
  }
  for (const req of snapshot.lateCorrectionRequests || []) {
    ops.push({
      pathSegments: ['schools', uid, 'lateCorrectionRequests', lateCorrectionDocId(req)],
      data: buildLateCorrectionRequestPayload(uid, req, serverTimestamp()),
    });
  }

  try {
    await commitBatchedWrites(ops);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `schools/${uid}/*`);
  }
}

export async function pushFullLocalStateToCloud(
  uid: string,
  snapshot: FullLocalSchoolSnapshot,
  replaceExisting = false
): Promise<void> {
  const schoolPath = `schools/${uid}`;
  const schoolRef = doc(db, 'schools', uid);
  try {
    const existing = await getDoc(schoolRef);
    recordFirestoreOps({ reads: 1 });
    if (!existing.exists()) {
      await setDoc(
        schoolRef,
        buildSchoolConfigCreatePayload(uid, snapshot.settings, serverTimestamp())
      );
      recordFirestoreOps({ writes: 1 });
    } else {
      await updateDoc(
        schoolRef,
        buildSchoolConfigUpdatePayload(snapshot.settings, serverTimestamp())
      );
      recordFirestoreOps({ writes: 1 });
    }

    if (replaceExisting) {
      await Promise.all([
        deleteAllInSubcollection(uid, 'students'),
        deleteAllInSubcollection(uid, 'attendance'),
        deleteAllInSubcollection(uid, 'subjects'),
        deleteAllInSubcollection(uid, 'schedules'),
        deleteAllInSubcollection(uid, 'subjectAssignments'),
        deleteAllInSubcollection(uid, 'subjectRecords'),
        deleteAllInSubcollection(uid, 'accounts'),
      ]);
    }

    await pushSubcollectionsToCloud(uid, snapshot);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, schoolPath);
  }
}

export function subscribeToSchoolWorkspace(
  uid: string,
  callbacks: WorkspaceSubscriptionCallbacks
): Unsubscribe {
  const unsubs: Unsubscribe[] = [];

  const handleListenerError = (path: string) => (error: unknown) => {
    try {
      handleFirestoreError(error, OperationType.LIST, path);
    } catch (wrapped) {
      callbacks.onError(wrapped, path);
    }
  };

  // 1. School Config document
  unsubs.push(
    onSnapshot(
      doc(db, 'schools', uid),
      (snap) => {
        if (!snap.metadata.fromCache) {
          recordFirestoreOps({ reads: 1 });
        }
        if (!snap.exists()) return;
        const nextSettings = extractSchoolSettingsFromDoc(
          snap.data(),
          callbacks.getFallbackSettings()
        );
        callbacks.onSettings(nextSettings);
        callbacks.onSyncActivity();
      },
      (error) => {
        try {
          handleFirestoreError(error, OperationType.GET, `schools/${uid}`);
        } catch (wrapped) {
          callbacks.onError(wrapped, `schools/${uid}`);
        }
      }
    )
  );

  // 2. Students
  unsubs.push(
    onSnapshot(
      query(collection(db, 'schools', uid, 'students'), where('ownerId', '==', uid)),
      (snap) => {
        if (!snap.metadata.fromCache) {
          recordFirestoreOps({ reads: Math.max(1, snap.docChanges().length) });
        }
        if (snap.empty) return;
        const list: Student[] = snap.docs
          .map((d) => {
            const data = d.data();
            return {
              nis: String(data.nis || ''),
              nama: String(data.nama || ''),
              kelas: String(data.kelas || ''),
              gender: data.gender === 'P' ? ('P' as const) : ('L' as const),
              no_wa_ortu: String(data.no_wa_ortu || ''),
              tahun_ajaran: String(data.tahun_ajaran || ''),
            };
          })
          .sort((a, b) => a.nis.localeCompare(b.nis, 'id'));
        callbacks.onStudents(list);
        callbacks.onSyncActivity();
      },
      handleListenerError(`schools/${uid}/students`)
    )
  );

  // 3. Attendance Records
  unsubs.push(
    onSnapshot(
      query(collection(db, 'schools', uid, 'attendance'), where('ownerId', '==', uid)),
      (snap) => {
        if (!snap.metadata.fromCache) {
          recordFirestoreOps({ reads: Math.max(1, snap.docChanges().length) });
        }
        const list: AttendanceRecord[] = snap.docs
          .map((d) => {
            const data = d.data();
            const earlyReason =
              typeof data.alasan_pulang_cepat === 'string' &&
              data.alasan_pulang_cepat.trim()
                ? data.alasan_pulang_cepat.trim()
                : undefined;
            return {
              id: String(data.id || d.id),
              tanggal: String(data.tanggal || ''),
              nis: String(data.nis || ''),
              nama: String(data.nama || ''),
              kelas: String(data.kelas || ''),
              jam_masuk: String(data.jam_masuk || '-'),
              jam_pulang: String(data.jam_pulang || '-'),
              ...(earlyReason ? { alasan_pulang_cepat: earlyReason } : {}),
              status: normalizeAttendanceStatus(data.status) ?? 'Hadir',
              keterangan:
                typeof data.keterangan === 'string' && data.keterangan
                  ? data.keterangan
                  : undefined,
              tahun_ajaran: String(data.tahun_ajaran || ''),
            };
          })
          .sort((a, b) => {
            const dateCmp = b.tanggal.localeCompare(a.tanggal);
            if (dateCmp !== 0) return dateCmp;
            return (b.jam_masuk || '').localeCompare(a.jam_masuk || '');
          });
        callbacks.onRecords(list);
        callbacks.onSyncActivity();
      },
      handleListenerError(`schools/${uid}/attendance`)
    )
  );

  // 4. Master Subjects
  unsubs.push(
    onSnapshot(
      query(collection(db, 'schools', uid, 'subjects'), where('ownerId', '==', uid)),
      (snap) => {
        if (!snap.metadata.fromCache) {
          recordFirestoreOps({ reads: Math.max(1, snap.docChanges().length) });
        }
        if (snap.empty) return;
        const list: MasterSubject[] = snap.docs
          .map((d) => {
            const data = d.data();
            return {
              id: String(data.id || d.id),
              kode: String(data.kode || ''),
              nama: String(data.nama || ''),
              deskripsi:
                typeof data.deskripsi === 'string' && data.deskripsi
                  ? data.deskripsi
                  : undefined,
            };
          })
          .sort((a, b) => a.nama.localeCompare(b.nama, 'id'));
        callbacks.onMasterSubjects(list);
        callbacks.onSyncActivity();
      },
      handleListenerError(`schools/${uid}/subjects`)
    )
  );

  // 5. Teacher Schedules
  unsubs.push(
    onSnapshot(
      query(collection(db, 'schools', uid, 'schedules'), where('ownerId', '==', uid)),
      (snap) => {
        if (!snap.metadata.fromCache) {
          recordFirestoreOps({ reads: Math.max(1, snap.docChanges().length) });
        }
        const list: TeacherSchedule[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: String(data.id || d.id),
            hari: data.hari as DayOfWeek,
            teacher_user_id: String(data.teacher_user_id || ''),
            teacher_name: String(data.teacher_name || ''),
            kelas: String(data.kelas || ''),
            mata_pelajaran: String(data.mata_pelajaran || ''),
            jam_mulai: String(data.jam_mulai || '07:00'),
            jam_selesai: String(data.jam_selesai || '08:30'),
            tahun_ajaran: String(data.tahun_ajaran || ''),
            semester: data.semester as SemesterKind,
          };
        });
        callbacks.onTeacherSchedules(list);
        callbacks.onSyncActivity();
      },
      handleListenerError(`schools/${uid}/schedules`)
    )
  );

  // 6. Subject Assignments
  unsubs.push(
    onSnapshot(
      query(
        collection(db, 'schools', uid, 'subjectAssignments'),
        where('ownerId', '==', uid)
      ),
      (snap) => {
        if (!snap.metadata.fromCache) {
          recordFirestoreOps({ reads: Math.max(1, snap.docChanges().length) });
        }
        const list: SubjectAssignment[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: String(data.id || d.id),
            teacher_user_id: String(data.teacher_user_id || ''),
            teacher_name: String(data.teacher_name || ''),
            kelas: String(data.kelas || ''),
            mata_pelajaran: String(data.mata_pelajaran || ''),
            hari: data.hari ? (data.hari as DayOfWeek) : undefined,
            jam_mulai: data.jam_mulai ? String(data.jam_mulai) : undefined,
            jam_selesai: data.jam_selesai ? String(data.jam_selesai) : undefined,
            tahun_ajaran: String(data.tahun_ajaran || ''),
            semester: data.semester as SemesterKind,
            source: data.source as SubjectAssignment['source'],
          };
        });
        callbacks.onSubjectAssignments(list);
        callbacks.onSyncActivity();
      },
      handleListenerError(`schools/${uid}/subjectAssignments`)
    )
  );

  // 7. Subject Attendance Records
  unsubs.push(
    onSnapshot(
      query(
        collection(db, 'schools', uid, 'subjectRecords'),
        where('ownerId', '==', uid)
      ),
      (snap) => {
        if (!snap.metadata.fromCache) {
          recordFirestoreOps({ reads: Math.max(1, snap.docChanges().length) });
        }
        const list: SubjectAttendanceRecord[] = snap.docs
          .map((d) => {
            const data = d.data();
            return {
              id: String(data.id || d.id),
              assignment_id: String(data.assignment_id || ''),
              tanggal: String(data.tanggal || ''),
              kelas: String(data.kelas || ''),
              mata_pelajaran: String(data.mata_pelajaran || ''),
              teacher_user_id: String(data.teacher_user_id || ''),
              teacher_name: String(data.teacher_name || ''),
              nis: String(data.nis || ''),
              nama: String(data.nama || ''),
              jam_masuk: String(data.jam_masuk || '-'),
              status: normalizeAttendanceStatus(data.status) ?? 'Hadir',
              keterangan:
                typeof data.keterangan === 'string' && data.keterangan
                  ? data.keterangan
                  : undefined,
              tahun_ajaran: String(data.tahun_ajaran || ''),
            };
          })
          .sort((a, b) => b.tanggal.localeCompare(a.tanggal));
        callbacks.onSubjectRecords(list);
        callbacks.onSyncActivity();
      },
      handleListenerError(`schools/${uid}/subjectRecords`)
    )
  );

  // 8. Internal App Accounts
  unsubs.push(
    onSnapshot(
      query(collection(db, 'schools', uid, 'accounts'), where('ownerId', '==', uid)),
      (snap) => {
        if (!snap.metadata.fromCache) {
          recordFirestoreOps({ reads: Math.max(1, snap.docChanges().length) });
        }
        if (snap.empty) return;
        const list: UserAccount[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: String(data.id || d.id),
            username: String(data.username || ''),
            password: String(data.password || ''),
            nama: String(data.nama || ''),
            nip: typeof data.nip === 'string' && data.nip ? data.nip : undefined,
            role: data.role as UserAccount['role'],
            jabatan: String(data.jabatan || ''),
            kelas_binaan:
              typeof data.kelas_binaan === 'string' && data.kelas_binaan
                ? data.kelas_binaan
                : undefined,
            foto_profil:
              typeof data.foto_profil === 'string' && data.foto_profil
                ? data.foto_profil
                : undefined,
          };
        });
        callbacks.onAccounts(list);
        callbacks.onSyncActivity();
      },
      handleListenerError(`schools/${uid}/accounts`)
    )
  );

  // 9. Late Correction Requests (Wali Kelas -> Master Admin)
  if (callbacks.onLateCorrectionRequests) {
    const onLateReq = callbacks.onLateCorrectionRequests;
    unsubs.push(
      onSnapshot(
        query(
          collection(db, 'schools', uid, 'lateCorrectionRequests'),
          where('ownerId', '==', uid)
        ),
        (snap) => {
          if (!snap.metadata.fromCache) {
            recordFirestoreOps({ reads: Math.max(1, snap.docChanges().length) });
          }
          const list: LateCorrectionRequest[] = snap.docs
            .map((d) => {
              const data = d.data();
              const status: LateCorrectionRequest['status'] =
                data.status === 'approved' || data.status === 'rejected'
                  ? data.status
                  : 'pending';
              return {
                id: String(data.id || d.id),
                tanggal: String(data.tanggal || ''),
                nis: String(data.nis || ''),
                nama: String(data.nama || ''),
                kelas: String(data.kelas || ''),
                jam_masuk_asal: String(data.jam_masuk_asal || '-'),
                alasan: String(data.alasan || ''),
                requested_by_user_id: String(data.requested_by_user_id || ''),
                requested_by_name: String(data.requested_by_name || 'Wali Kelas'),
                requested_at: String(data.requested_at || ''),
                status,
                resolved_by_name:
                  typeof data.resolved_by_name === 'string' && data.resolved_by_name
                    ? data.resolved_by_name
                    : undefined,
                resolved_at:
                  typeof data.resolved_at === 'string' && data.resolved_at
                    ? data.resolved_at
                    : undefined,
                catatan_admin:
                  typeof data.catatan_admin === 'string' && data.catatan_admin
                    ? data.catatan_admin
                    : undefined,
                tahun_ajaran: String(data.tahun_ajaran || ''),
              };
            })
            .sort((a, b) => b.requested_at.localeCompare(a.requested_at));
          onLateReq(list);
          callbacks.onSyncActivity();
        },
        handleListenerError(`schools/${uid}/lateCorrectionRequests`)
      )
    );
  }

  return () => {
    for (const unsub of unsubs) {
      unsub();
    }
  };
}

// =============================================================================
// Fine-grained Cloud Write Operations
// =============================================================================

export async function saveSchoolSettingsToCloud(
  uid: string,
  settings: SchoolSettings
): Promise<void> {
  const path = `schools/${uid}`;
  const ref = doc(db, 'schools', uid);
  try {
    const snap = await getDoc(ref);
    recordFirestoreOps({ reads: 1 });
    if (!snap.exists()) {
      await setDoc(ref, buildSchoolConfigCreatePayload(uid, settings, serverTimestamp()));
      recordFirestoreOps({ writes: 1 });
    } else {
      await updateDoc(ref, buildSchoolConfigUpdatePayload(settings, serverTimestamp()));
      recordFirestoreOps({ writes: 1 });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function upsertStudentToCloud(uid: string, student: Student): Promise<void> {
  const docId = studentDocId(student);
  const path = `schools/${uid}/students/${docId}`;
  try {
    await setDoc(
      doc(db, 'schools', uid, 'students', docId),
      buildStudentPayload(uid, student, serverTimestamp())
    );
    recordFirestoreOps({ writes: 1 });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function bulkUpsertStudentsToCloud(
  uid: string,
  students: Student[]
): Promise<void> {
  if (students.length === 0) return;
  try {
    await commitBatchedWrites(
      students.map((s) => ({
        pathSegments: ['schools', uid, 'students', studentDocId(s)],
        data: buildStudentPayload(uid, s, serverTimestamp()),
      }))
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `schools/${uid}/students`);
  }
}

export async function deleteStudentFromCloud(
  uid: string,
  student: Pick<Student, 'nis' | 'tahun_ajaran'>
): Promise<void> {
  const docId = studentDocId(student);
  const path = `schools/${uid}/students/${docId}`;
  try {
    await deleteDoc(doc(db, 'schools', uid, 'students', docId));
    recordFirestoreOps({ deletes: 1 });
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function upsertAttendanceToCloud(
  uid: string,
  record: AttendanceRecord
): Promise<void> {
  const docId = attendanceDocId(record);
  const path = `schools/${uid}/attendance/${docId}`;
  try {
    await setDoc(
      doc(db, 'schools', uid, 'attendance', docId),
      buildAttendancePayload(uid, record, serverTimestamp())
    );
    recordFirestoreOps({ writes: 1 });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function bulkUpsertAttendanceToCloud(
  uid: string,
  records: AttendanceRecord[]
): Promise<void> {
  if (records.length === 0) return;
  try {
    await commitBatchedWrites(
      records.map((r) => ({
        pathSegments: ['schools', uid, 'attendance', attendanceDocId(r)],
        data: buildAttendancePayload(uid, r, serverTimestamp()),
      }))
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `schools/${uid}/attendance`);
  }
}

export async function deleteAttendanceFromCloud(
  uid: string,
  record: Pick<AttendanceRecord, 'id' | 'tanggal' | 'nis'>
): Promise<void> {
  const docId = attendanceDocId(record);
  const path = `schools/${uid}/attendance/${docId}`;
  try {
    await deleteDoc(doc(db, 'schools', uid, 'attendance', docId));
    recordFirestoreOps({ deletes: 1 });
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function bulkDeleteAttendanceFromCloud(
  uid: string,
  records: Array<Pick<AttendanceRecord, 'id' | 'tanggal' | 'nis'>>
): Promise<void> {
  if (records.length === 0) return;
  try {
    for (let i = 0; i < records.length; i += BATCH_LIMIT) {
      const chunk = records.slice(i, i + BATCH_LIMIT);
      const batch = writeBatch(db);
      for (const r of chunk) {
        batch.delete(doc(db, 'schools', uid, 'attendance', attendanceDocId(r)));
      }
      await batch.commit();
      recordFirestoreOps({ deletes: chunk.length });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `schools/${uid}/attendance`);
  }
}

export async function upsertLateCorrectionRequestToCloud(
  uid: string,
  request: LateCorrectionRequest
): Promise<void> {
  const docId = lateCorrectionDocId(request);
  const path = `schools/${uid}/lateCorrectionRequests/${docId}`;
  try {
    await setDoc(
      doc(db, 'schools', uid, 'lateCorrectionRequests', docId),
      buildLateCorrectionRequestPayload(uid, request, serverTimestamp())
    );
    recordFirestoreOps({ writes: 1 });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function clearAllAttendanceInCloud(uid: string): Promise<void> {
  await Promise.all([
    deleteAllInSubcollection(uid, 'attendance'),
    deleteAllInSubcollection(uid, 'subjectRecords'),
  ]);
}

export async function upsertMasterSubjectToCloud(
  uid: string,
  subject: MasterSubject
): Promise<void> {
  const docId = toSafeFirestoreDocId(subject.id, 'subj');
  const path = `schools/${uid}/subjects/${docId}`;
  try {
    await setDoc(
      doc(db, 'schools', uid, 'subjects', docId),
      buildMasterSubjectPayload(uid, subject, serverTimestamp())
    );
    recordFirestoreOps({ writes: 1 });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteMasterSubjectFromCloud(
  uid: string,
  subjectId: string
): Promise<void> {
  const docId = toSafeFirestoreDocId(subjectId, 'subj');
  const path = `schools/${uid}/subjects/${docId}`;
  try {
    await deleteDoc(doc(db, 'schools', uid, 'subjects', docId));
    recordFirestoreOps({ deletes: 1 });
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function upsertTeacherScheduleToCloud(
  uid: string,
  schedule: TeacherSchedule
): Promise<void> {
  const docId = toSafeFirestoreDocId(schedule.id, 'sch');
  const path = `schools/${uid}/schedules/${docId}`;
  try {
    await setDoc(
      doc(db, 'schools', uid, 'schedules', docId),
      buildTeacherSchedulePayload(uid, schedule, serverTimestamp())
    );
    recordFirestoreOps({ writes: 1 });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteTeacherScheduleFromCloud(
  uid: string,
  scheduleId: string
): Promise<void> {
  const docId = toSafeFirestoreDocId(scheduleId, 'sch');
  const path = `schools/${uid}/schedules/${docId}`;
  try {
    await deleteDoc(doc(db, 'schools', uid, 'schedules', docId));
    recordFirestoreOps({ deletes: 1 });
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function upsertSubjectAssignmentToCloud(
  uid: string,
  assignment: SubjectAssignment
): Promise<void> {
  const docId = toSafeFirestoreDocId(assignment.id, 'asg');
  const path = `schools/${uid}/subjectAssignments/${docId}`;
  try {
    await setDoc(
      doc(db, 'schools', uid, 'subjectAssignments', docId),
      buildSubjectAssignmentPayload(uid, assignment, serverTimestamp())
    );
    recordFirestoreOps({ writes: 1 });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteSubjectAssignmentFromCloud(
  uid: string,
  assignmentId: string
): Promise<void> {
  const docId = toSafeFirestoreDocId(assignmentId, 'asg');
  const path = `schools/${uid}/subjectAssignments/${docId}`;
  try {
    await deleteDoc(doc(db, 'schools', uid, 'subjectAssignments', docId));
    recordFirestoreOps({ deletes: 1 });
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function upsertSubjectRecordToCloud(
  uid: string,
  record: SubjectAttendanceRecord
): Promise<void> {
  const docId = toSafeFirestoreDocId(record.id, 'srec');
  const path = `schools/${uid}/subjectRecords/${docId}`;
  try {
    await setDoc(
      doc(db, 'schools', uid, 'subjectRecords', docId),
      buildSubjectRecordPayload(uid, record, serverTimestamp())
    );
    recordFirestoreOps({ writes: 1 });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function bulkUpsertSubjectRecordsToCloud(
  uid: string,
  records: SubjectAttendanceRecord[]
): Promise<void> {
  if (records.length === 0) return;
  try {
    await commitBatchedWrites(
      records.map((r) => ({
        pathSegments: ['schools', uid, 'subjectRecords', toSafeFirestoreDocId(r.id, 'srec')],
        data: buildSubjectRecordPayload(uid, r, serverTimestamp()),
      }))
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `schools/${uid}/subjectRecords`);
  }
}

export async function bulkDeleteSubjectRecordsFromCloud(
  uid: string,
  records: Array<Pick<SubjectAttendanceRecord, 'id'>>
): Promise<void> {
  if (records.length === 0) return;
  try {
    for (let i = 0; i < records.length; i += BATCH_LIMIT) {
      const chunk = records.slice(i, i + BATCH_LIMIT);
      const batch = writeBatch(db);
      for (const r of chunk) {
        batch.delete(
          doc(db, 'schools', uid, 'subjectRecords', toSafeFirestoreDocId(r.id, 'srec'))
        );
      }
      await batch.commit();
      recordFirestoreOps({ deletes: chunk.length });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `schools/${uid}/subjectRecords`);
  }
}

export async function syncAllAccountsToCloud(
  uid: string,
  accounts: UserAccount[]
): Promise<void> {
  const path = `schools/${uid}/accounts`;
  try {
    await deleteAllInSubcollection(uid, 'accounts');
    await commitBatchedWrites(
      accounts.map((acc) => ({
        pathSegments: ['schools', uid, 'accounts', toSafeFirestoreDocId(acc.id, 'usr')],
        data: buildUserAccountPayload(uid, acc, serverTimestamp()),
      }))
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}
