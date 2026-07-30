"use client";

/**
 * The live task list, extracted from `cowork-old-frontend`.
 *
 * Ported from `app/coworking/tasks/page.js` lines 3850–4067 — the effect that
 * decides which tasks a person sees. The queries, the role branches, the
 * visibility filter and the parent-chain back-fill are **unchanged**. What was
 * removed is only the page's own concerns: `setupChatCountListeners`, which
 * belongs to the chat panel, and `window.__fetchFolderParents`, which was a
 * global the page assigned and never read on this path.
 *
 * **Why this is a hook and not a repository call.** Firestore pushes; a fetch
 * does not. The old app's task list updates the moment somebody reassigns work,
 * and a periodic refetch would show a person a task that is no longer theirs
 * until the next poll. It is also role-dependent in a way no single query
 * expresses — see below.
 *
 * ## Three listeners, because Firestore cannot express this in one
 *
 * Firestore has no OR across different fields, so "tasks I created **or** tasks
 * assigned to me" needs a listener each, merged by id into one map:
 *
 * | Role | Listeners |
 * |---|---|
 * | `employee` | assigned to me |
 * | `tl` | created by me · assigned to me |
 * | `ceo` | created by me · assigned to me · where I am the approver |
 *
 * Getting this wrong fails in a specific and bad direction: a missing listener
 * hides work somebody owns, and a broadened query shows them a colleague's.
 * That is why it is copied rather than reimplemented.
 *
 * ## Two maps, deliberately
 *
 * `tasks` is what the list renders. `taskMap` additionally holds intermediate
 * parents fetched to complete a folder chain — nodes that must exist for the
 * tree to resolve but must not appear as top-level rows. Collapsing them into
 * one collection puts folder internals in somebody's task list.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  collection,
  doc as fsDoc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { firebaseDb } from "./coworkFirebase";

export function useCoworkTaskList(employeeId, role) {
  const [allTasks, setAllTasks] = useState([]);
  const [allTaskMap, setAllTaskMap] = useState(() => new Map());
  const [loading, setLoading] = useState(true);
  const allTaskMapRef = useRef(new Map());

  useEffect(() => {
    if (!employeeId || !role) return;
    const tasksRef = collection(firebaseDb, "cowork_tasks");

    // Build a role-appropriate Firestore query so we never pull unrelated tasks
    let taskQuery;
    if (role === "ceo") {
      taskQuery = query(tasksRef, where("assignedBy", "==", employeeId), orderBy("updatedAt", "desc"), limit(100));
    } else if (role === "tl") {
      taskQuery = query(tasksRef, where("assignedBy", "==", employeeId), orderBy("updatedAt", "desc"), limit(100));
    } else {
      taskQuery = query(tasksRef, where("assigneeIds", "array-contains", employeeId), orderBy("updatedAt", "desc"), limit(100));
    }

    // For CEO: also listen to tasks assigned TO the CEO (by TL etc.)
    let unsubCeoAssigned = null;
    let unsubApprover = null;
    if (role === "ceo") {
      const qAssigned = query(tasksRef, where("assigneeIds", "array-contains", employeeId), orderBy("updatedAt", "desc"), limit(100));
      unsubCeoAssigned = onSnapshot(qAssigned, snap => {
        if (snap.empty) return;
        setAllTasks(prev => {
          const map = new Map(prev.map(t => [t.taskId, t]));
          snap.docs.forEach(d => { map.set(d.id, { ...d.data(), taskId: d.id }); });
          return [...map.values()];
        });
      }, () => { });

      // Also listen to self-assign tasks where CEO is the approver
      const qApprover = query(tasksRef, where("approverId", "==", employeeId), orderBy("updatedAt", "desc"), limit(100));
      unsubApprover = onSnapshot(qApprover, snap => {
        if (snap.empty) return;
        setAllTasks(prev => {
          const map = new Map(prev.map(t => [t.taskId, t]));
          snap.docs.forEach(d => { map.set(d.id, { ...d.data(), taskId: d.id }); });
          return [...map.values()];
        });
      }, () => { });
    }

    // Helper: apply the same visibility filter used in loadAllTasks
    const applyVisibilityFilter = (taskData) => {
      if (role === "ceo") {
        const assignedToMe = (taskData.assigneeIds || []).includes(employeeId);
        const createdByMe = taskData.assignedBy === employeeId || taskData.createdByCeo === true || taskData.assignedByRole === "ceo";
        const isMyApproval = taskData.approverId === employeeId || (Array.isArray(taskData.visibleTo) && taskData.visibleTo.includes(employeeId));
        return assignedToMe || createdByMe || isMyApproval;
      }
      return true;
    };

    const unsub = onSnapshot(
      taskQuery,
      snap => {
        setLoading(false);
        if (snap.empty) return;
        const newDocs = snap.docs.map(d => ({ ...d.data(), taskId: d.id })).filter(applyVisibilityFilter);

        setAllTasks(prev => {
          const map = new Map(prev.map(t => [t.taskId, t]));
          // Keep any folder parents already fetched
          prev.filter(t => t.isFolder).forEach(f => map.set(f.taskId, f));
          newDocs.forEach(t => map.set(t.taskId, t));
          const newList = [...map.values()];
          // Build fullMap preserving ALL intermediate nodes from previous ref
          const fullMap = new Map(newList.map(t => [t.taskId, t]));
          allTaskMapRef.current.forEach((t, id) => { if (!fullMap.has(id)) fullMap.set(id, t); });
          allTaskMapRef.current = fullMap;
          setAllTaskMap(fullMap);
          return newList;
        });

        // For employees: fetch full parent chain so folder structure shows correctly
        if (role === "employee") {
          const existingIds = new Set(newDocs.map(t => t.taskId));
          const initialParentIds = [...new Set(
            newDocs.filter(t => t.parentTaskId && !existingIds.has(t.parentTaskId) && !t.isForwardedTask).map(t => t.parentTaskId)
          )];
          if (initialParentIds.length) {
            const fetchChain = async (startIds) => {
              const fetched = [];
              const alreadyFetched = new Set([...existingIds]);
              let toFetch = startIds.filter(id => !alreadyFetched.has(id));
              while (toFetch.length > 0 && fetched.length < 20) {
                const docs = await Promise.all(
                  toFetch.map(id => getDoc(fsDoc(firebaseDb, "cowork_tasks", id)))
                );
                const nextToFetch = [];
                docs.forEach(doc => {
                  if (!doc.exists()) return;
                  const t = { ...doc.data(), taskId: doc.id };
                  alreadyFetched.add(t.taskId);
                  if (t.isFolder !== true && !t.parentTaskId && !t.assigneeIds?.length) t.isFolder = true;
                  fetched.push(t);
                  if (t.parentTaskId && !t.isForwardedTask && !alreadyFetched.has(t.parentTaskId)) {
                    nextToFetch.push(t.parentTaskId);
                    alreadyFetched.add(t.parentTaskId);
                  }
                });
                toFetch = nextToFetch;
              }
              return fetched;
            };
            fetchChain(initialParentIds).then(fetchedTasks => {
              if (!fetchedTasks.length) return;
              // Only root folders go into allTasks — intermediates go to allTaskMap only
              const rootFolders = fetchedTasks.filter(t => !t.parentTaskId);
              setAllTasks(prev => {
                const map = new Map(prev.map(t => [t.taskId, t]));
                rootFolders.forEach(t => map.set(t.taskId, t));
                const newList = [...map.values()];
                const fullMap = new Map(newList.map(t => [t.taskId, t]));
                fetchedTasks.forEach(t => fullMap.set(t.taskId, t));
                allTaskMapRef.current = fullMap;
                setAllTaskMap(fullMap);
                return newList;
              });
            }).catch(e => console.warn("[FolderParents]", e.message));
          }
        }
      },
      err => { setLoading(false); console.error("realtime tasks listener:", err); }
    );

    // For TL: also listen to tasks assigned TO them (second query needed because Firestore
    // doesn’t support OR queries across different fields in a single listener)
    let unsubTlAssigned = null;
    if (role === "tl") {
      const tlAssignedQuery = query(
        tasksRef,
        where("assigneeIds", "array-contains", employeeId),
        orderBy("updatedAt", "desc"),
        limit(100)
      );
      unsubTlAssigned = onSnapshot(
        tlAssignedQuery,
        snap => {
          if (snap.empty) return;
          setAllTasks(prev => {
            const map = new Map(prev.map(t => [t.taskId, t]));
            snap.docs.forEach(d => {
              const updated = { ...d.data(), taskId: d.id };
              map.set(d.id, updated);
            });
            const newList = [...map.values()];
            const taskMapLocal = new Map(newList.map(t => [t.taskId, t]));
            allTaskMapRef.current = taskMapLocal;
            setAllTaskMap(taskMapLocal);
            return newList;
          });
        },
        err => console.error("realtime tasks listener (TL assigned):", err)
      );
    }

    return () => {
      unsub();
      if (unsubTlAssigned) unsubTlAssigned();
      if (unsubCeoAssigned) unsubCeoAssigned();
      if (unsubApprover) unsubApprover();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId, role]);

  /** A task by id, including folder parents absent from the rendered list. */
  const getTask = useCallback((taskId) => allTaskMap.get(taskId) ?? null, [allTaskMap]);

  return { tasks: allTasks, taskMap: allTaskMap, loading, getTask };
}
