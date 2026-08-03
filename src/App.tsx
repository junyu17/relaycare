import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native";

import { uniqueId } from "./lib/id";
import { getStoredLanguage, initStoredLanguage, setStoredLanguage } from "./lib/language";
import { ocrProviderName } from "./lib/ocr";
import { initialState } from "./data";
import { AuthProvider, useAuth, type CreateHouseholdArgs } from "./auth/AuthContext";
import { AuthScreen, OnboardingScreen } from "./auth/AuthScreen";
import { HouseholdSwitcher } from "./auth/HouseholdSwitcher";
import {
  fetchHouseholdState,
  subscribeHouseholdState,
  subscribeRoleNotifications,
  cacheHouseholdState,
  getCachedHouseholdState,
  deleteAccount,
  generateHouseholdCode,
  getHouseholdCode,
  leaveHousehold,
  removeMember,
  dissolveHousehold,
  updateMyName,
  subscribeUserNotifications,
  type HouseholdCode,
  type HouseholdSummary,
  listWeeklyReports,
  recordWeeklyReport,
  type WeeklyReport
} from "./lib/db";
import { QRCode } from "./components/QRCode";
import { CustomTaskModal, OtherTimelineModal } from "./components/CustomEntryModals";
import * as Notifications from "expo-notifications";
import * as Clipboard from "expo-clipboard";
import * as cloudActions from "./lib/actions";
import * as Linking from "expo-linking";
import { isSupabaseConfigured } from "./lib/supabase";
import { ConsentGate } from "./legal/ConsentGate";
import { openLegal } from "./legal/consent";
import { Paywall } from "./paywall/Paywall";
import { canUse, effectivePlan, checkTaskQuota, checkOcrQuota, checkFileSize } from "./lib/entitlement";
import { errorMessage } from "./lib/error";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  addDocument,
  addTimelineEvent,
  claimTask,
  completeTask,
  confirmDocumentAndCreateTask,
  createTask,
  formatDateTime,
  hasPermission,
  isHouseholdInviteExpired,
  memberName,
  rejectTask,
  requestHandoff,
  toggleDigest,
  updateMemberRole,
  withAudit,
  withRoleNotification
} from "./domain";
import { buildTaskCsvRows, type TaskCsvRow } from "./lib/export/csv";
import { buildReportHtml, type PdfReportSection } from "./lib/export/pdf";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { printToFileAsync } from "expo-print";
import {
  Language,
  Translate,
  auditActionLabel,
  documentStatusLabel,
  eventTypeLabel,
  languageLabel,
  languageShortLabel,
  makeTranslator,
  nextLanguage,
  priorityLabel,
  roleLabel,
  roleShortLabel,
  taskStatusLabel
} from "./i18n";
import {
  AppState,
  AuditAction,
  CareEvent,
  DocumentRecord,
  EventType,
  Member,
  Permission,
  Plan,
  Role,
  RoleNotification,
  Task
} from "./types";

type TabKey = "home" | "tasks" | "timeline" | "documents" | "audit" | "settings";
type IconName = keyof typeof Ionicons.glyphMap;

const tabs: { key: TabKey; labelKey: string; icon: IconName }[] = [
  { key: "home", labelKey: "tabs.home", icon: "home-outline" },
  { key: "tasks", labelKey: "tabs.tasks", icon: "checkbox-outline" },
  { key: "timeline", labelKey: "tabs.timeline", icon: "time-outline" },
  { key: "documents", labelKey: "tabs.documents", icon: "document-text-outline" },
  { key: "settings", labelKey: "tabs.settings", icon: "settings-outline" }
];

const eventTypes: ("all" | EventType)[] = ["all", "appointment", "transport", "visit", "reminder", "document"];
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true
  })
});

// Android 8+ 需要通知 channel（Android 13+ 无 channel 则本地通知不显示）。
// 在 app 启动时幂等创建；channel 一经创建不可改名，后续仅更新描述。
async function ensureAndroidNotificationChannels(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    await Notifications.setNotificationChannelAsync("default", {
      name: "TaskKin Care",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#0f766e"
    });
    await Notifications.setNotificationChannelAsync("critical", {
      name: "Critical tasks",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      bypassDnd: true,
      lightColor: "#b91c1c"
    });
  } catch (e) {
    console.warn("ensureAndroidNotificationChannels failed", e);
  }
}
void ensureAndroidNotificationChannels();

const roleOptions: Role[] = ["coordinator", "caregiver", "viewer"];
type TaskTemplateKey = "ride" | "paperwork" | "supplies";
type TimelineTemplateKey = "checkin" | "pickup" | "paperwork";

const taskTemplateKeys: TaskTemplateKey[] = ["ride", "paperwork", "supplies"];
const timelineTemplateKeys: TimelineTemplateKey[] = ["checkin", "pickup", "paperwork"];

const palette = {
  ink: "#172026",
  muted: "#65717a",
  page: "#f6f8f5",
  surface: "#ffffff",
  line: "#d9e1dc",
  teal: "#0f766e",
  blue: "#315b91",
  amber: "#a76600",
  red: "#b42318",
  green: "#2f7d32",
  gray: "#59636b"
};

const roleRank: Record<Role, number> = {
  coordinator: 0,
  caregiver: 1,
  viewer: 2
};

function timeValue(value?: string): number {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function orderMembersForDisplay(members: Member[], currentMemberId?: string): Member[] {
  return members
    .map((member, index) => ({ member, index }))
    .sort((left, right) => {
      if (left.member.id === currentMemberId) return -1;
      if (right.member.id === currentMemberId) return 1;
      const roleDelta = roleRank[left.member.role] - roleRank[right.member.role];
      if (roleDelta !== 0) return roleDelta;
      const joinedDelta = timeValue(left.member.createdAt) - timeValue(right.member.createdAt);
      if (joinedDelta !== 0) return joinedDelta;
      return left.index - right.index;
    })
    .map(({ member }) => member);
}

function orderAppStateForDisplay(state: AppState, currentMemberId?: string): AppState {
  return {
    ...state,
    members: orderMembersForDisplay(state.members, currentMemberId),
    tasks: [...state.tasks].sort((left, right) => timeValue(right.createdAt) - timeValue(left.createdAt)),
    events: [...state.events].sort((left, right) => timeValue(left.startsAt) - timeValue(right.startsAt)),
    documents: [...state.documents].sort((left, right) => timeValue(right.uploadedAt) - timeValue(left.uploadedAt))
  };
}

interface CloudProps {
  state: AppState;
  actor: Member;
  householdId: string;
  households: HouseholdSummary[];
  onSwitchHousehold: (householdId: string) => Promise<void>;
  onCreateHousehold: (args: CreateHouseholdArgs) => Promise<void>;
  onSignOut: () => void;
}

function LocalApp(props: { cloud?: CloudProps } = {}) {
  const cloud = props.cloud;
  const [localState, setLocalState] = useState<AppState>(initialState);
  const rawState = cloud ? cloud.state : localState;
  const setState = setLocalState;
  const [activeTab, setActiveTab] = useState<TabKey>("home");
  const [actorId, setActorId] = useState("m-maya");
  const [eventType, setEventType] = useState<"all" | EventType>("all");
  const [memberFilter, setMemberFilter] = useState("all");
  const [reportText, setReportText] = useState<Record<Language, string> | null>(null);
  const [reportVisible, setReportVisible] = useState(false);
  const [weeklyReports, setWeeklyReports] = useState<WeeklyReport[]>([]);
  useEffect(() => {
    if (reportVisible && cloud?.householdId) {
      listWeeklyReports(cloud.householdId, 12)
        .then(setWeeklyReports)
        .catch((e) => console.warn("list_weekly_reports failed", e));
    }
  }, [reportVisible, cloud?.householdId]);
  const [language, setLanguage] = useState<Language>("en");
  const [roleEditorMemberId, setRoleEditorMemberId] = useState<string | null>(null);
  const [handoffTaskId, setHandoffTaskId] = useState<string | null>(null);
  const [documentSafetyConfirmed, setDocumentSafetyConfirmed] = useState(false);
  const [paywallVisible, setPaywallVisible] = useState(false);
  const [householdSwitcherVisible, setHouseholdSwitcherVisible] = useState(false);
  const [joinCode, setJoinCode] = useState<HouseholdCode | null>(null);
  const [customTaskVisible, setCustomTaskVisible] = useState(false);
  const [otherTimelineVisible, setOtherTimelineVisible] = useState(false);
  const [nameEditorVisible, setNameEditorVisible] = useState(false);
  const [nameEditValue, setNameEditValue] = useState("");

  const t = useMemo(() => makeTranslator(language), [language]);

  const report = reportText ? reportText[language] : "";

  useEffect(() => {
    // Seed language cache from storage on mount; cloud push notifications read
    // it synchronously via getStoredLanguage().
    void initStoredLanguage().then(setLanguage);
  }, []);

  const localActor = useMemo(
    () => rawState.members.find((member) => member.id === actorId) ?? rawState.members[0] ?? initialState.members[0],
    [actorId, rawState.members]
  );
  const actor = cloud ? cloud.actor : localActor;
  const state = useMemo(() => orderAppStateForDisplay(rawState, actor.id), [actor.id, rawState]);
  const plan = effectivePlan(state.household);

  // cloud 模式：加载当前加入码（仅协调人有意义）。
  useEffect(() => {
    if (!cloud || actor.role !== "coordinator") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setJoinCode(null);
      return;
    }
    void getHouseholdCode()
      .then(setJoinCode)
      .catch((e) => {
        // P0-1: 读码失败不再静默（FINAL_LAUNCH_AUDIT 2026-08-02）；保留空码状态并记录。
        console.warn("get_household_code failed", e);
        setJoinCode(null);
      });
  }, [cloud, actor.role, state.members.length]);

  const roleEditorMember = useMemo(
    () => state.members.find((member) => member.id === roleEditorMemberId),
    [roleEditorMemberId, state.members]
  );

  const handoffTask = useMemo(
    () => state.tasks.find((task) => task.id === handoffTaskId),
    [handoffTaskId, state.tasks]
  );

  // hasPermission reads state.roleDefinitions; depending on the full `state` keeps
  // exhaustive-deps satisfied while remaining correct (members/roles are the only
  // fields that affect the filtered set).
  const handoffCandidates = useMemo(
    () =>
      state.members.filter(
        (member) =>
          member.id !== actor.id && member.inviteStatus !== "pending" && hasPermission(state, member.role, "task:claim")
      ),
    [actor.id, state]
  );

  const can = (permission: Permission) => hasPermission(state, actor.role, permission);

  const canAccessTab = (tab: TabKey) => {
    if (tab === "home" || tab === "settings") {
      return true;
    }
    if (tab === "timeline") {
      return can("timeline:read");
    }
    if (tab === "tasks") {
      return can("task:create") || can("task:claim") || can("task:handoff") || can("task:complete");
    }
    if (tab === "documents") {
      return can("document:read") || can("document:upload");
    }
    if (tab === "audit") {
      return can("audit:read");
    }

    return false;
  };

  const visibleTabs = tabs.filter((tab) => canAccessTab(tab.key));

  // Tab guard: fall back to home when the active tab becomes inaccessible
  // (e.g. switching to a role without audit:read). Kept as an effect so it
  // covers every path that can change actor.role or activeTab.
  useEffect(() => {
    if (!canAccessTab(activeTab)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveTab("home");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, actor.role]);

  const runIfAllowed = (permission: Permission, action: () => void) => {
    if (!can(permission)) {
      showMessage(t("alerts.permissionTitle"), t("alerts.missingPermission", { name: actor.name, permission }));
      return;
    }

    action();
  };

  const reportCloudActionFailure = (e?: unknown) => {
    showMessage(t("alerts.actionFailedTitle"), e ? errorMessage(e) : t("alerts.actionFailedBody"));
  };

  const runCloudAction = (action: Promise<unknown>) => {
    void action.catch((e) => reportCloudActionFailure(e));
  };

  const onClaim = (task: Task) => {
    runIfAllowed("task:claim", () => {
      if (cloud) {
        runCloudAction(
          cloudActions.claimTask({ householdId: cloud.householdId, taskId: task.id, actor, taskTitle: task.title })
        );
      } else {
        setState((current) => claimTask(current, task.id, actor, t));
      }
    });
  };

  const onReject = (task: Task) => {
    runIfAllowed("task:claim", () => {
      if (cloud) {
        runCloudAction(
          cloudActions.rejectTask({
            householdId: cloud.householdId,
            taskId: task.id,
            actor,
            taskTitle: task.title,
            reason: "Declined"
          })
        );
      } else {
        setState((current) => rejectTask(current, task.id, actor, t));
      }
    });
  };

  const onHandoff = (task: Task) => {
    runIfAllowed("task:handoff", () => setHandoffTaskId(task.id));
  };

  const onConfirmHandoff = (target: Member) => {
    if (!handoffTask) {
      return;
    }

    runIfAllowed("task:handoff", () => {
      if (cloud) {
        void cloudActions
          .requestHandoff({
            householdId: cloud.householdId,
            taskId: handoffTask.id,
            actor,
            target,
            taskTitle: handoffTask.title
          })
          .then(() => setHandoffTaskId(null))
          .catch(reportCloudActionFailure);
      } else {
        setState((current) => requestHandoff(current, handoffTask.id, actor, target, t));
        setHandoffTaskId(null);
      }
    });
  };

  const onComplete = (task: Task) => {
    runIfAllowed("task:complete", () => {
      if (cloud) {
        runCloudAction(
          cloudActions.completeTask({
            householdId: cloud.householdId,
            taskId: task.id,
            actor,
            taskTitle: task.title,
            proof: "Completed"
          })
        );
      } else {
        setState((current) => completeTask(current, task.id, actor, t));
      }
    });
  };

  const onDeleteTask = (task: Task) => {
    Alert.alert(t("tasks.delete"), t("tasks.deleteConfirm"), [
      { style: "cancel", text: t("paywall.close") },
      {
        style: "destructive",
        text: t("tasks.delete"),
        onPress: () => {
          if (cloud) {
            runCloudAction(cloudActions.deleteTask({ taskId: task.id }));
          } else {
            setState((current) => ({ ...current, tasks: current.tasks.filter((item) => item.id !== task.id) }));
          }
        }
      }
    ]);
  };

  const onDeleteEvent = (eventId: string) => {
    Alert.alert(t("timeline.delete"), t("timeline.deleteConfirm"), [
      { style: "cancel", text: t("paywall.close") },
      {
        style: "destructive",
        text: t("timeline.delete"),
        onPress: () => {
          if (cloud) {
            runCloudAction(cloudActions.deleteCareEvent({ eventId }));
          } else {
            setState((current) => ({ ...current, events: current.events.filter((item) => item.id !== eventId) }));
          }
        }
      }
    ]);
  };

  // 自定义任务创建。
  const onCreateCustomTask = (args: {
    title: string;
    dueAt: string;
    expectedMinutes: number;
    priority: "normal" | "critical";
  }) => {
    runIfAllowed("task:create", () => {
      const quota = checkTaskQuota(state);
      if (!quota.ok) {
        Alert.alert(t("quota.taskTitle"), t("quota.taskBody"), [
          { text: t("quota.upgrade"), onPress: () => setPaywallVisible(true) },
          { style: "cancel", text: t("paywall.close") }
        ]);
        return;
      }
      if (cloud) {
        runCloudAction(
          cloudActions.createTask({
            householdId: cloud.householdId,
            actor,
            title: args.title,
            expectedMinutes: args.expectedMinutes,
            dueAt: args.dueAt,
            priority: args.priority,
            subtasks: []
          })
        );
      } else {
        setState((current) =>
          createTask(
            current,
            actor,
            {
              title: args.title,
              expectedMinutes: args.expectedMinutes,
              dueAt: args.dueAt,
              priority: args.priority,
              subtasks: []
            },
            t
          )
        );
      }
    });
  };

  // 其他时间线更新（可选创建关联任务）。
  const onCreateOtherUpdate = (args: {
    type: string;
    title: string;
    startsAt: string;
    ownerId?: string;
    createTask: boolean;
    taskTitle?: string;
    taskDueAt?: string;
    taskMinutes?: number;
    taskPriority?: "normal" | "critical";
  }) => {
    runIfAllowed("timeline:add", () => {
      if (cloud) {
        // 先建时间线事件，再建关联任务（如有）。
        cloudActions
          .addTimelineEvent({
            householdId: cloud.householdId,
            actor,
            type: args.type,
            title: args.title,
            startsAt: args.startsAt,
            location: ""
          })
          .then(() => {
            if (args.createTask && args.taskTitle && args.taskDueAt && args.taskMinutes && args.taskPriority) {
              return cloudActions.createTask({
                householdId: cloud.householdId,
                actor,
                title: args.taskTitle,
                expectedMinutes: args.taskMinutes,
                dueAt: args.taskDueAt,
                priority: args.taskPriority,
                subtasks: []
              });
            }
            return undefined;
          })
          .catch((e) => {
            // 时间线已保存但任务创建失败 -> 明确提示。
            showMessage(t("alerts.actionFailedTitle"), errorMessage(e));
          });
      } else {
        setState((current) => {
          const withEvent = addTimelineEvent(
            current,
            actor,
            { type: args.type as EventType, title: args.title, startsAt: args.startsAt, location: "" },
            t
          );
          if (args.createTask && args.taskTitle && args.taskDueAt && args.taskMinutes && args.taskPriority) {
            return createTask(
              withEvent,
              actor,
              {
                title: args.taskTitle,
                expectedMinutes: args.taskMinutes,
                dueAt: args.taskDueAt,
                priority: args.taskPriority,
                subtasks: []
              },
              t
            );
          }
          return withEvent;
        });
      }
    });
  };

  const onPickDocument = async () => {
    if (!can("document:upload")) {
      showMessage(t("alerts.permissionTitle"), t("alerts.uploadBlocked", { name: actor.name }));
      return;
    }

    if (!documentSafetyConfirmed) {
      showMessage(t("alerts.documentSafetyTitle"), t("alerts.documentSafetyBody"));
      return;
    }

    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: ["application/pdf", "image/*"]
      });

      if (!result.canceled) {
        const asset = result.assets[0];
        const name = asset?.name ?? t("task.dynamic.uploadedReview");
        // 单文件 25MB 预检（服务端 RPC 也会校验）。
        if (asset?.size && !checkFileSize(asset.size)) {
          Alert.alert(t("quota.fileSizeTitle"), t("quota.fileSizeBody"));
          return;
        }
        // OCR 月配额预检（sample 不计配额，仅真实上传计）。
        const ocrQuota = checkOcrQuota(state);
        if (!ocrQuota.ok) {
          Alert.alert(t("quota.ocrTitle"), t("quota.ocrBody"), [
            { text: t("quota.upgrade"), onPress: () => setPaywallVisible(true) },
            { style: "cancel", text: t("paywall.close") }
          ]);
          return;
        }
        if (cloud) {
          const storagePath = `${cloud.householdId}/${uniqueId()}-${name}`;
          const fileBody = asset?.uri ? await (await fetch(asset.uri)).blob() : undefined;
          runCloudAction(
            cloudActions.addDocument({
              householdId: cloud.householdId,
              actor,
              name,
              source: "manual_upload",
              fileUri: asset?.uri,
              fileBody,
              storagePath: fileBody ? storagePath : undefined
            })
          );
        } else {
          setState((current) => addDocument(current, actor, name, "manual_upload", t));
        }
      }
    } catch {
      reportCloudActionFailure();
    }
  };

  const onConfirmDocument = (documentId: string) => {
    runIfAllowed("document:upload", () => {
      if (cloud) {
        const doc = state.documents.find((d) => d.id === documentId);
        runCloudAction(
          cloudActions.confirmDocumentAndCreateTask({
            householdId: cloud.householdId,
            actor,
            documentId,
            documentName: doc?.name ?? "",
            taskTitle: doc?.suggestedAction ?? "Confirm document requirements",
            dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            subtasks: ["Review document", "Add result to timeline"]
          })
        );
      } else {
        setState((current) => confirmDocumentAndCreateTask(current, documentId, actor, t));
      }
    });
  };

  const onGenerateReport = () => {
    runIfAllowed("report:export", () => {
      const result = generateLocalizedWeeklyReport(state, actor, language, t);
      const snapshot = result.state;
      const localized: Record<Language, string> = {
        en: buildLocalizedReportText(snapshot, "en", makeTranslator("en")),
        zh: buildLocalizedReportText(snapshot, "zh", makeTranslator("zh")),
        es: buildLocalizedReportText(snapshot, "es", makeTranslator("es"))
      };
      if (cloud) {
        // R2（B6）：手动生成落库周报历史（record_weekly_report 内部写一次 report.generated 审计，
        // 不再重复调 recordReportGenerated 的通知+审计；H4 的导出动作单独记 report.exported）
        void recordWeeklyReport(cloud.householdId, {
          tasksCreated: snapshot.tasks.length,
          tasksCompleted: snapshot.tasks.filter((task) => task.status === "completed").length,
          events: snapshot.events?.length ?? 0
        }).catch((e) => console.warn("record_weekly_report failed", e));
      } else {
        setState(snapshot);
      }
      setReportText(localized);
      setReportVisible(true);
    });
  };

  const onShareReport = async () => {
    if (!report) {
      return;
    }

    try {
      await Share.share({ title: t("report.modalTitle"), message: report });
    } catch {
      reportCloudActionFailure();
    }
  };

  // R4（IOS_SUBMISSION_DEV_SPEC）：报表导出 CSV（Plus 专属；客户端 canUse 为 UX 门禁——
  // 导出仅序列化本家庭已授权 state 走系统分享面板，无跨用户泄露面，属付费墙商业约束）。
  // R2 修复（B3/B4）：CSV 落真实文件（UTF-8 BOM + 9 列 + 规范文件名）+ 导出审计（H4）。
  const completionByTask = new Map<string, string>();
  for (const entry of state.auditEvents ?? []) {
    if (entry.action === "task.completed") {
      completionByTask.set(entry.entityId, entry.createdAt ?? "");
    }
  }
  const exportRows: TaskCsvRow[] = state.tasks.map((task) => ({
    taskId: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    ownerName: memberName(state, task.ownerId ?? "", t),
    ownerRole: roleLabel(state.members.find((m) => m.id === task.ownerId)?.role ?? "caregiver", t),
    createdAt: task.createdAt ?? "",
    dueAt: task.dueAt ?? "",
    completedAt: completionByTask.get(task.id) ?? ""
  }));
  const onExportCsv = async () => {
    const csv = buildTaskCsvRows(exportRows);
    const fileName = `taskkin-tasks-${new Date().toISOString().slice(0, 10)}.csv`;
    try {
      const dir = Paths.cache;
      const file = new File(`${dir}/${fileName}`);
      await file.write(csv);
      const uri = file.uri;
      await Sharing.shareAsync(uri, { mimeType: "text/csv", dialogTitle: fileName });
      await exportAudit();
    } catch {
      // 用户取消分享等，静默
    }
  };
  // R2（B2）：PDF 导出——HTML 模板 → expo-print 生成文件 → 分享。
  const onExportPdf = async () => {
    const weekLabel = `Week of ${new Date().toISOString().slice(0, 10)}`;
    const sections: PdfReportSection[] = [
      {
        title: t("report.historyTitle"),
        lines: state.tasks.slice(0, 20).map((task) => `${task.title} — ${task.status}`)
      }
    ];
    const html = buildReportHtml(state.household?.name ?? "Household", weekLabel, sections);
    const fileName = `taskkin-weekly-report-${new Date().toISOString().slice(0, 10)}.pdf`;
    try {
      // printToFileAsync 直接生成 PDF 文件（uri），分享即可（无需再复制）。
      const { uri } = await printToFileAsync({ html, width: 612, height: 792 });
      await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: fileName });
      await exportAudit();
    } catch {
      // 用户取消分享等，静默
    }
  };
  const exportAudit = async () => {
    if (!cloud || !actor) return;
    try {
      await cloudActions.recordReportExported({ householdId: cloud.householdId, actor });
    } catch {
      // best-effort audit
    }
  };

  const onUpdateMemberRole = (memberId: string, role: Role) => {
    runIfAllowed("member:role_update", () => {
      if (memberId === actor.id) {
        showMessage(t("alerts.permissionTitle"), t("alerts.selfRoleBlocked"));
        return;
      }

      if (cloud) {
        const member = state.members.find((m) => m.id === memberId);
        runCloudAction(
          cloudActions.updateMemberRole({
            householdId: cloud.householdId,
            actor,
            memberId,
            memberName: member?.name ?? "",
            role
          })
        );
      } else {
        setState((current) => updateMemberRole(current, memberId, role, actor, t));
      }
    });
  };

  const onCreateTaskFromTemplate = (templateKey: TaskTemplateKey) => {
    runIfAllowed("task:create", () => {
      const quota = checkTaskQuota(state);
      if (!quota.ok) {
        Alert.alert(t("quota.taskTitle"), t("quota.taskBody"), [
          { text: t("quota.upgrade"), onPress: () => setPaywallVisible(true) },
          { style: "cancel", text: t("paywall.close") }
        ]);
        return;
      }
      const input = taskTemplateInput(templateKey, t);
      if (cloud) {
        runCloudAction(
          cloudActions.createTask({
            householdId: cloud.householdId,
            actor,
            title: input.title,
            expectedMinutes: input.expectedMinutes,
            dueAt: input.dueAt,
            priority: input.priority,
            subtasks: input.subtasks
          })
        );
      } else {
        setState((current) => createTask(current, actor, input, t));
      }
    });
  };

  const onCreateTimelineEvent = (templateKey: TimelineTemplateKey) => {
    runIfAllowed("timeline:add", () => {
      const input = timelineTemplateInput(templateKey, t);
      if (cloud) {
        runCloudAction(
          cloudActions.addTimelineEvent({
            householdId: cloud.householdId,
            actor,
            type: input.type,
            title: input.title,
            startsAt: input.startsAt,
            location: input.location
          })
        );
      } else {
        setState((current) => addTimelineEvent(current, actor, input, t));
      }
    });
  };

  // dev 测试切换套餐（仅本地 demo 模式；cloud 走真实 IAP，不提供）。
  const onDevSetPlus = (nextPlan: "free" | "monthly" | "yearly") => {
    setState((current) => ({
      ...current,
      household: {
        ...current.household,
        plusPlan: nextPlan,
        plusUntil: nextPlan === "free" ? undefined : new Date(Date.now() + 365 * 86400000).toISOString(),
        plusOwnerId: nextPlan === "free" ? undefined : actor.id
      }
    }));
  };

  // 删除账号 + 家庭数据（cloud 模式；Apple 5.1.1）。
  const onDeleteAccount = () => {
    if (!cloud) return;
    Alert.alert(t("settings.deleteAccountTitle"), t("settings.deleteAccountConfirm"), [
      { style: "cancel", text: t("paywall.close") },
      {
        style: "destructive",
        text: t("settings.deleteAccountTitle"),
        onPress: () => {
          deleteAccount()
            .then(() => cloud.onSignOut())
            .catch((e) => Alert.alert("Error", errorMessage(e)));
        }
      }
    ]);
  };

  // 生成/刷新 6 位加入码（协调人）。
  const onGenerateCode = () => {
    if (!cloud) return;
    generateHouseholdCode()
      .then(setJoinCode)
      .catch((e) => Alert.alert("Error", errorMessage(e)));
  };

  // 移除成员（协调人，不能移除自己）。
  const onRemoveMember = (memberId: string) => {
    if (!cloud) return;
    const target = state.members.find((member) => member.id === memberId);
    const targetName = target ? memberDisplayName(target, t) : t("member.fallback");
    Alert.alert(t("settings.removeMember"), t("settings.removeConfirm"), [
      { style: "cancel", text: t("paywall.close") },
      {
        style: "destructive",
        text: t("settings.removeMember"),
        onPress: () => {
          removeMember(memberId)
            .then(async () => {
              setState((current) => {
                const next = {
                  ...current,
                  members: current.members.filter((member) => member.id !== memberId),
                  notificationPreferences: current.notificationPreferences.filter((pref) => pref.memberId !== memberId)
                };
                void cacheHouseholdState(cloud.householdId, next);
                return next;
              });
              showMessage(t("settings.memberRemovedTitle"), t("settings.memberRemovedBody", { name: targetName }));
              try {
                const refreshed = await fetchHouseholdState(cloud.householdId);
                setState(refreshed);
                await cacheHouseholdState(cloud.householdId, refreshed);
              } catch {
                // The optimistic state above already reflects the successful RPC.
              }
            })
            .catch((e) => reportCloudActionFailure(e));
        }
      }
    ]);
  };

  // 普通成员退出家庭。
  const onLeaveHousehold = () => {
    if (!cloud) return;
    Alert.alert(t("settings.leaveHousehold"), t("settings.leaveConfirm"), [
      { style: "cancel", text: t("paywall.close") },
      {
        style: "destructive",
        text: t("settings.leaveHousehold"),
        onPress: () =>
          Alert.alert(t("settings.leaveHousehold"), t("confirm.sure"), [
            { style: "cancel", text: t("paywall.close") },
            {
              style: "destructive",
              text: t("settings.leaveHousehold"),
              onPress: () => {
                leaveHousehold(cloud.householdId)
                  .then(() => cloud.onSignOut())
                  .catch((e) => Alert.alert("Error", errorMessage(e)));
              }
            }
          ])
      }
    ]);
  };

  // 协调人解散家庭。
  const onDissolveHousehold = () => {
    if (!cloud) return;
    Alert.alert(t("settings.dissolveHousehold"), t("settings.dissolveConfirm"), [
      { style: "cancel", text: t("paywall.close") },
      {
        style: "destructive",
        text: t("settings.dissolveHousehold"),
        onPress: () =>
          Alert.alert(t("settings.dissolveHousehold"), t("confirm.sure"), [
            { style: "cancel", text: t("paywall.close") },
            {
              style: "destructive",
              text: t("settings.dissolveHousehold"),
              onPress: () => {
                dissolveHousehold()
                  .then(() => cloud.onSignOut())
                  .catch((e) => Alert.alert("Error", errorMessage(e)));
              }
            }
          ])
      }
    ]);
  };

  const onOpenNameEditor = () => {
    setNameEditValue(actor.name);
    setNameEditorVisible(true);
  };

  const onSaveName = () => {
    const trimmed = nameEditValue.trim();
    if (!trimmed) {
      Alert.alert(t("tasks.errTitleEmpty"), "");
      return;
    }
    setNameEditorVisible(false);
    if (cloud) {
      updateMyName(trimmed, cloud.householdId)
        .then(() => {
          Alert.alert(t("settings.save"), t("settings.updateNameHelper"));
        })
        .catch((e) => Alert.alert("Error", errorMessage(e)));
    } else {
      setState((current) => ({
        ...current,
        members: current.members.map((m) => (m.id === actor.id ? { ...m, name: trimmed } : m))
      }));
    }
  };

  const metrics = useMemo(() => {
    const open = state.tasks.filter((task) => task.status !== "completed");
    const ownerRate = state.tasks.length
      ? Math.round((state.tasks.filter((task) => task.ownerId).length / state.tasks.length) * 100)
      : 0;
    const criticalOpen = open.filter((task) => task.priority === "critical").length;
    return {
      open: open.length,
      completed: state.tasks.length - open.length,
      ownerRate,
      criticalOpen
    };
  }, [state.tasks]);

  const filteredEvents = useMemo(
    () =>
      state.events
        .filter((event) => eventType === "all" || event.type === eventType)
        .filter((event) => memberFilter === "all" || event.ownerId === memberFilter)
        .sort((left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime()),
    [eventType, memberFilter, state.events]
  );

  return (
    <View style={styles.app}>
      <StatusBar style="dark" />
      <View style={styles.topBar}>
        <View style={styles.brandMark}>
          <Ionicons name="git-compare-outline" size={22} color={palette.surface} />
        </View>
        <View style={styles.brandText}>
          <Text style={styles.productName} numberOfLines={1} allowFontScaling>
            TaskKin Care
          </Text>
          <Text style={styles.productMeta} numberOfLines={1} allowFontScaling>
            Non-PHI
          </Text>
        </View>
        <TouchableOpacity
          style={styles.languageButton}
          accessibilityRole="button"
          accessibilityLabel={t("settings.plan")}
          onPress={() => setPaywallVisible(true)}
        >
          <Ionicons name={plan === "free" ? "ribbon-outline" : "ribbon"} size={16} color={palette.teal} />
          <Text style={styles.languageButtonText} allowFontScaling>
            {plan === "free" ? t("plan.badge.free") : t("plan.badge.plus")}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.languageButton}
          accessibilityRole="button"
          accessibilityLabel={t("language.switch", { language: languageLabel(language) })}
          onPress={() =>
            setLanguage((current) => {
              const next = nextLanguage(current);
              void setStoredLanguage(next);
              return next;
            })
          }
        >
          <Ionicons name="language-outline" size={16} color={palette.teal} />
          <Text style={styles.languageButtonText} allowFontScaling>
            {languageShortLabel(language)}
          </Text>
        </TouchableOpacity>
        {cloud && (
          <TouchableOpacity
            style={[styles.languageButton, styles.headerIconButton]}
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            onPress={cloud.onSignOut}
          >
            <Ionicons name="log-out-outline" size={16} color={palette.teal} />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <SectionTitle icon="people-outline" title={t("home.careCircle")} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.actorRow}>
          {state.members.map((member) => {
            const isPending = member.inviteStatus === "pending";
            return (
              <TouchableOpacity
                key={member.id}
                style={[
                  styles.actorChip,
                  actor.id === member.id && styles.actorChipActive,
                  isPending && styles.actorChipDisabled
                ]}
                accessibilityRole="button"
                accessibilityState={{ disabled: isPending, selected: actor.id === member.id }}
                accessibilityLabel={
                  isPending ? t("settings.pendingInvite") : t("member.actAs", { name: memberDisplayName(member, t) })
                }
                disabled={isPending || !!cloud}
                onPress={() => setActorId(member.id)}
              >
                <Text style={[styles.actorName, actor.id === member.id && styles.actorNameActive]} allowFontScaling>
                  {memberDisplayName(member, t)}
                </Text>
                <Text style={[styles.actorRole, actor.id === member.id && styles.actorRoleActive]} allowFontScaling>
                  {isPending ? t("settings.pendingInvite") : roleShortLabel(member.role, t)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={styles.notice}>
          <Ionicons name="medkit-outline" size={20} color={palette.amber} />
          <Text style={styles.noticeText} allowFontScaling>
            {t("notice.boundary")}
          </Text>
        </View>

        {activeTab === "home" &&
          renderHome(
            state,
            actor,
            metrics,
            language,
            t,
            (memberId) => {
              if (actor.id !== memberId && actor.role !== "coordinator") {
                showMessage(t("alerts.permissionTitle"), t("alerts.notificationBlocked", { name: actor.name }));
                return;
              }

              // R5（IOS_SUBMISSION_DEV_SPEC）：摘要/静默为 Plus 专属——Free 点击打开付费墙
              //（服务端 update_notification_preference 仍强制套餐门禁，AC5-1）。
              if (!canUse("advancedNotifications", plan)) {
                setPaywallVisible(true);
                return;
              }

              if (cloud) {
                const pref = state.notificationPreferences.find((p) => p.memberId === memberId);
                runCloudAction(
                  cloudActions.toggleDigest({
                    householdId: cloud.householdId,
                    actor,
                    memberId,
                    enabled: !(pref?.taskDigest ?? true)
                  })
                );
              } else {
                setState((current) => toggleDigest(current, memberId, actor, t));
              }
            },
            onClaim,
            onComplete,
            setActiveTab,
            onGenerateReport
          )}
        {activeTab === "tasks" &&
          renderTasks(
            state,
            actor,
            language,
            t,
            onCreateTaskFromTemplate,
            onClaim,
            onReject,
            onHandoff,
            onComplete,
            onDeleteTask,
            () => setCustomTaskVisible(true)
          )}
        {activeTab === "timeline" &&
          renderTimeline(
            state,
            actor,
            filteredEvents,
            eventType,
            setEventType,
            memberFilter,
            setMemberFilter,
            language,
            t,
            onCreateTimelineEvent,
            onDeleteEvent,
            () => setOtherTimelineVisible(true)
          )}
        {activeTab === "documents" &&
          renderDocuments(
            state,
            actor,
            language,
            t,
            documentSafetyConfirmed,
            () => setDocumentSafetyConfirmed((current) => !current),
            onPickDocument,
            onConfirmDocument
          )}
        {activeTab === "settings" &&
          renderSettings(
            state,
            actor,
            language,
            t,
            report,
            onGenerateReport,
            setRoleEditorMemberId,
            isHouseholdInviteExpired(state),
            () => setActiveTab("audit"),
            !!cloud,
            cloud ? () => setHouseholdSwitcherVisible(true) : undefined,
            (kind) => void openLegal(kind, language),
            plan,
            () => setPaywallVisible(true),
            cloud ? onDeleteAccount : undefined,
            cloud ? joinCode : null,
            onGenerateCode,
            cloud ? onRemoveMember : undefined,
            cloud ? onLeaveHousehold : undefined,
            cloud ? onDissolveHousehold : undefined,
            cloud ? onOpenNameEditor : undefined
          )}
        {activeTab === "audit" && can("audit:read") && renderAudit(state, language, t, () => setActiveTab("settings"))}
      </ScrollView>

      <View style={styles.tabBar}>
        {visibleTabs.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tabButton, activeTab === tab.key && styles.tabButtonActive]}
            accessibilityRole="button"
            accessibilityLabel={t(tab.labelKey)}
            onPress={() => setActiveTab(tab.key)}
          >
            <Ionicons name={tab.icon} size={22} color={activeTab === tab.key ? palette.teal : palette.gray} />
            <Text style={[styles.tabLabel, activeTab === tab.key && styles.tabLabelActive]} allowFontScaling>
              {t(tab.labelKey)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Modal visible={reportVisible} transparent animationType="slide" onRequestClose={() => setReportVisible(false)}>
        <View style={styles.modalScrim}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle} allowFontScaling>
                {t("report.modalTitle")}
              </Text>
              <IconButton icon="share-outline" label={t("report.share")} onPress={onShareReport} />
              {canUse("export", plan) ? (
                <>
                  <IconButton icon="document-text-outline" label={t("report.exportPdf")} onPress={onExportPdf} />
                  <IconButton icon="download-outline" label={t("report.exportCsv")} onPress={onExportCsv} />
                </>
              ) : (
                // R2（H3）：Free 显示置灰带锁导出按钮，点击打开付费墙（AC4-1）
                <TouchableOpacity
                  style={styles.lockedExportBtn}
                  accessibilityRole="button"
                  accessibilityLabel={t("report.exportCsv")}
                  onPress={() => setPaywallVisible(true)}
                >
                  <Ionicons name="lock-closed" size={16} color="#94a3b8" />
                </TouchableOpacity>
              )}
              <IconButton icon="close-outline" label={t("report.close")} onPress={() => setReportVisible(false)} />
            </View>
            {weeklyReports.length > 0 && (
              <View style={styles.weeklyHistory}>
                <Text style={styles.weeklyHistoryTitle} allowFontScaling>
                  {t("report.historyTitle")}
                </Text>
                {weeklyReports.map((w) => (
                  <View key={w.weekStart} style={styles.weeklyHistoryRow}>
                    <Text style={styles.weeklyHistoryDate} allowFontScaling>
                      {w.weekStart}
                    </Text>
                    <Text style={styles.weeklyHistoryMetrics} allowFontScaling>
                      {t("report.historySummary", {
                        created: String(w.metrics?.tasksCreated ?? 0),
                        completed: String(w.metrics?.tasksCompleted ?? 0)
                      })}
                    </Text>
                  </View>
                ))}
              </View>
            )}
            <ScrollView style={styles.modalReportScroll}>
              <Text style={styles.reportText} selectable allowFontScaling>
                {report}
              </Text>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Paywall
        visible={paywallVisible}
        onClose={() => setPaywallVisible(false)}
        t={t}
        language={language}
        currentPlan={plan}
        isCoordinator={actor.role === "coordinator"}
        householdId={cloud?.householdId}
        onPurchased={() => setPaywallVisible(false)}
        onDevSetPlus={onDevSetPlus}
      />

      <CustomTaskModal
        visible={customTaskVisible}
        onClose={() => setCustomTaskVisible(false)}
        t={t}
        onCreate={onCreateCustomTask}
      />
      <OtherTimelineModal
        visible={otherTimelineVisible}
        onClose={() => setOtherTimelineVisible(false)}
        t={t}
        state={state}
        actor={actor}
        canCreateTask={can("task:create")}
        onCreate={onCreateOtherUpdate}
      />

      <Modal
        visible={nameEditorVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setNameEditorVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={Platform.OS === "ios" ? 12 : 0}
          style={styles.keyboardModal}
        >
          <View style={styles.modalScrim}>
            <View style={styles.roleModalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle} allowFontScaling>
                  {t("settings.updateName")}
                </Text>
                <IconButton
                  icon="close-outline"
                  label={t("paywall.close")}
                  onPress={() => setNameEditorVisible(false)}
                />
              </View>
              <TextInput
                style={styles.roleNameInput}
                value={nameEditValue}
                onChangeText={setNameEditValue}
                placeholder={t("settings.updateNameHelper")}
                autoFocus
              />
              <TouchableOpacity
                style={[styles.actionButton, styles.actionPrimary, styles.nameSaveButton]}
                onPress={onSaveName}
              >
                <Text style={styles.actionTextLight} allowFontScaling>
                  {t("settings.save")}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {cloud && (
        <HouseholdSwitcher
          visible={householdSwitcherVisible}
          onClose={() => setHouseholdSwitcherVisible(false)}
          households={cloud.households}
          currentName={state.household.name}
          memberName={actor.name}
          memberRelation={actor.relation || "Coordinator"}
          onSwitch={async (householdId) => {
            await cloud.onSwitchHousehold(householdId);
            setActiveTab("home");
            setHouseholdSwitcherVisible(false);
          }}
          onCreate={async (args) => {
            await cloud.onCreateHousehold(args);
            setActiveTab("home");
            setHouseholdSwitcherVisible(false);
          }}
          t={t}
        />
      )}

      <Modal
        visible={roleEditorMember != null}
        transparent
        animationType="slide"
        onRequestClose={() => setRoleEditorMemberId(null)}
      >
        <View style={styles.modalScrim}>
          <View style={styles.roleModalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle} allowFontScaling>
                {t("settings.roleChoiceTitle", {
                  name: roleEditorMember ? memberDisplayName(roleEditorMember, t) : ""
                })}
              </Text>
              <IconButton
                icon="close-outline"
                label={t("settings.closeRolePicker")}
                onPress={() => setRoleEditorMemberId(null)}
              />
            </View>
            <View style={styles.roleChoiceList}>
              {roleEditorMember &&
                roleOptions.map((role) => {
                  const active = roleEditorMember.role === role;
                  return (
                    <TouchableOpacity
                      key={role}
                      style={[styles.roleChoiceButton, active && styles.roleChoiceButtonActive]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={t("settings.changeRole", {
                        name: memberDisplayName(roleEditorMember, t),
                        role: roleLabel(role, t)
                      })}
                      disabled={active}
                      onPress={() => {
                        onUpdateMemberRole(roleEditorMember.id, role);
                        setRoleEditorMemberId(null);
                      }}
                    >
                      <View style={styles.roleChoiceIcon}>
                        <Ionicons
                          name={active ? "checkmark-circle-outline" : "ellipse-outline"}
                          size={20}
                          color={palette.teal}
                        />
                      </View>
                      <View style={styles.listText}>
                        <Text style={styles.itemTitle} allowFontScaling>
                          {roleLabel(role, t)}
                        </Text>
                        <Text style={styles.itemMeta} allowFontScaling>
                          {roleCapabilityLabels(role, t).join(" · ")}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={handoffTask != null}
        transparent
        animationType="slide"
        onRequestClose={() => setHandoffTaskId(null)}
      >
        <View style={styles.modalScrim}>
          <View style={styles.roleModalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle} allowFontScaling>
                {t("handoff.title")}
              </Text>
              <IconButton icon="close-outline" label={t("handoff.close")} onPress={() => setHandoffTaskId(null)} />
            </View>
            {handoffTask && (
              <Text style={styles.bodyText} allowFontScaling>
                {t("handoff.copy", { task: taskTitle(handoffTask, t) })}
              </Text>
            )}
            <View style={styles.roleChoiceList}>
              {handoffCandidates.length === 0 ? (
                <Text style={styles.bodyText} allowFontScaling>
                  {t("handoff.empty")}
                </Text>
              ) : (
                handoffCandidates.map((candidate) => {
                  const candidateAvailability = memberAvailability(candidate, t);
                  const candidateMeta = [roleLabel(candidate.role, t), candidateAvailability]
                    .filter(Boolean)
                    .join(" · ");

                  return (
                    <TouchableOpacity
                      key={candidate.id}
                      style={styles.roleChoiceButton}
                      accessibilityRole="button"
                      accessibilityLabel={t("handoff.choose", { name: memberDisplayName(candidate, t) })}
                      onPress={() => onConfirmHandoff(candidate)}
                    >
                      <View style={styles.roleChoiceIcon}>
                        <Ionicons name="person-circle-outline" size={22} color={palette.teal} />
                      </View>
                      <View style={styles.listText}>
                        <Text style={styles.itemTitle} allowFontScaling>
                          {memberDisplayName(candidate, t)}
                        </Text>
                        <Text style={styles.itemMeta} allowFontScaling>
                          {candidateMeta}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function CloudApp() {
  const { user, householdId, households, loading, signOut, switchHousehold, createHousehold } = useAuth();
  const [state, setState] = useState<AppState | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!householdId) return;
    let active = true;
    let channel: RealtimeChannel | null = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setErr(null);
    fetchHouseholdState(householdId)
      .then((s) => {
        if (active) {
          setState(s);
          cacheHouseholdState(householdId, s);
        }
      })
      .catch(async (e) => {
        if (!active) return;
        const cached = await getCachedHouseholdState(householdId);
        if (cached) setState(cached);
        else setErr(errorMessage(e));
      });
    channel = subscribeHouseholdState(householdId, () => {
      fetchHouseholdState(householdId)
        .then((s) => {
          if (active) {
            setState(s);
            cacheHouseholdState(householdId, s);
          }
        })
        .catch((e) => {
          // I7: Realtime 刷新失败不再静默——记录并保留 last-known-good（不整页报错）。
          console.warn("household realtime refetch failed", e);
        });
    });
    return () => {
      active = false;
      channel?.unsubscribe();
    };
  }, [householdId]);

  useEffect(() => {
    if (!householdId) return;
    void Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true } }).catch(() => {});
    const noteChannel = subscribeRoleNotifications(householdId, (n) => {
      const t = makeTranslator(getStoredLanguage());
      Notifications.scheduleNotificationAsync({
        content: { title: t(n.titleKey, n.values), body: t(n.bodyKey, n.values) },
        trigger: null
      }).catch(() => {});
    });
    return () => {
      noteChannel?.unsubscribe();
    };
  }, [householdId]);

  // 用户级通知（解散/被移除）：弹通知并自动登出回到登录/引导页。
  useEffect(() => {
    if (!user) return;
    const ch = subscribeUserNotifications(user.id, (n) => {
      const tr = makeTranslator(getStoredLanguage());
      const name = n.householdName ?? "";
      const title = n.kind === "household_dissolved" ? tr("userNotif.dissolvedTitle") : tr("userNotif.removedTitle");
      const body =
        n.kind === "household_dissolved"
          ? tr("userNotif.dissolvedBody", { name })
          : tr("userNotif.removedBody", { name });
      Notifications.scheduleNotificationAsync({ content: { title, body }, trigger: null }).catch(() => {});
      Alert.alert(title, body, [{ text: "OK", onPress: () => void signOut() }]);
    });
    return () => {
      ch.unsubscribe();
    };
  }, [user, signOut]);

  if (loading) {
    return (
      <View style={cloudStyles.center}>
        <Text>Loading…</Text>
      </View>
    );
  }
  if (!user) return <AuthScreen />;
  if (!householdId) return <OnboardingScreen />;
  if (err) {
    return (
      <View style={cloudStyles.center}>
        <Text>Load error: {err}</Text>
        <TouchableOpacity style={cloudStyles.btn} onPress={signOut}>
          <Text style={cloudStyles.btnText}>Sign out</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (!state) {
    return (
      <View style={cloudStyles.center}>
        <Text>Loading household…</Text>
      </View>
    );
  }

  const actor = state.members.find((m) => m.userId === user.id);
  if (!actor) {
    // I5: 找不到当前用户的成员身份时，绝不 fallback 到他人身份渲染能力——
    // 展示错误态并允许退出登录（真正权限仍由 RLS/RPC 兜底，但 UI 不给错误按钮）。
    return (
      <View style={cloudStyles.center}>
        <Text style={{ textAlign: "center", marginBottom: 12 }}>
          {"无法确定你的成员身份。\n你可能已被移出该家庭，请重新登录或联系家庭协调人。"}
        </Text>
        <TouchableOpacity
          style={{ padding: 10, backgroundColor: "#333", borderRadius: 8 }}
          onPress={() => void signOut()}
        >
          <Text style={{ color: "#fff" }}>退出登录</Text>
        </TouchableOpacity>
      </View>
    );
  }
  return (
    <LocalApp
      cloud={{
        state,
        actor,
        householdId,
        households,
        onSwitchHousehold: switchHousehold,
        onCreateHousehold: createHousehold,
        onSignOut: signOut
      }}
    />
  );
}

export default function App() {
  // R11（IOS_SUBMISSION_DEV_SPEC）：生产构建必须配置 Supabase，否则视为配置错误直接抛错（不静默进本地演示）。
  if (!isSupabaseConfigured) {
    if (!__DEV__) {
      throw new Error("Supabase is not configured in a production build");
    }
    return (
      <ConsentGate>
        <LocalApp />
      </ConsentGate>
    );
  }
  return (
    <ConsentGate>
      <AuthProvider>
        <CloudApp />
      </AuthProvider>
    </ConsentGate>
  );
}

const cloudStyles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24, backgroundColor: "#f7faf7" },
  title: { fontSize: 22, fontWeight: "700", color: "#0f766e", marginBottom: 12 },
  note: { fontSize: 12, color: "#64748b", marginTop: 12, textAlign: "center", maxWidth: 300 },
  btn: { backgroundColor: "#0f766e", paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8, marginTop: 20 },
  btnText: { color: "#fff", fontWeight: "600" }
});

function renderHome(
  state: AppState,
  actor: Member,
  metrics: { open: number; completed: number; ownerRate: number; criticalOpen: number },
  language: Language,
  t: Translate,
  onToggleDigest: (memberId: string) => void,
  onClaimTask: (task: Task) => void,
  onCompleteTask: (task: Task) => void,
  onOpenTab: (tab: TabKey) => void,
  onGenerateReport: () => void
) {
  const roleNotifications = state.roleNotifications
    .filter((notification) => notification.audience === "all" || notification.audience === actor.role)
    .slice(0, 4);
  const homeActions = buildHomeActions(
    state,
    actor,
    metrics,
    language,
    t,
    onClaimTask,
    onCompleteTask,
    onOpenTab,
    onGenerateReport
  );
  const actorRelation = memberRelation(actor, t);
  const actorAvailability = memberAvailability(actor, t);

  return (
    <View>
      <View style={styles.metricGrid}>
        <Metric label={t("home.openTasks")} value={String(metrics.open)} icon="albums-outline" tone="blue" />
        <Metric
          label={t("home.completed")}
          value={String(metrics.completed)}
          icon="checkmark-done-outline"
          tone="green"
        />
        <Metric label={t("home.ownerRate")} value={`${metrics.ownerRate}%`} icon="person-circle-outline" tone="teal" />
        <Metric
          label={t("home.criticalOpen")}
          value={String(metrics.criticalOpen)}
          icon="alert-circle-outline"
          tone="red"
        />
      </View>

      <SectionTitle icon="flash-outline" title={t("home.nextActions")} />
      <View style={styles.panel}>
        <Text style={styles.bodyText} allowFontScaling>
          {t("home.nextActionsCopy")}
        </Text>
        {homeActions.map((action) => (
          <View key={action.id} style={styles.nextActionItem}>
            <View style={styles.nextActionIcon}>
              <Ionicons name={action.icon} size={18} color={palette.surface} />
            </View>
            <View style={styles.listText}>
              <Text style={styles.itemTitle} allowFontScaling>
                {action.title}
              </Text>
              <Text style={styles.itemMeta} allowFontScaling>
                {action.meta}
              </Text>
            </View>
            <ActionButton
              icon={action.buttonIcon}
              label={action.buttonLabel}
              tone={action.buttonTone}
              onPress={action.onPress}
            />
          </View>
        ))}
      </View>

      <SectionTitle icon="lock-closed-outline" title={t("home.rolePermissions")} />
      <View style={styles.panel}>
        <View style={styles.panelHeader}>
          <View>
            <Text style={styles.panelTitle} allowFontScaling>
              {actor.name}
            </Text>
            {actorRelation ? (
              <Text style={styles.panelSubtitle} allowFontScaling>
                {actorRelation}
              </Text>
            ) : null}
          </View>
          <Pill tone={actor.role === "viewer" ? "muted" : "info"} text={roleLabel(actor.role, t)} />
        </View>
        {actorAvailability ? (
          <Text style={styles.bodyText} allowFontScaling>
            {t("home.availability", { value: actorAvailability })}
          </Text>
        ) : null}
        <View style={styles.permissionWrap}>
          {roleCapabilityLabels(actor.role, t).map((capability) => (
            <View key={capability} style={styles.permissionChip}>
              <Ionicons name="checkmark-circle-outline" size={14} color={palette.blue} />
              <Text style={styles.permissionText} allowFontScaling>
                {capability}
              </Text>
            </View>
          ))}
        </View>
      </View>

      <SectionTitle icon="mail-unread-outline" title={t("home.inviteStatus")} />
      <View style={styles.panel}>
        <Text style={styles.bodyText} allowFontScaling>
          {t("home.inviteCopy", { date: formatDateTime(state.household.inviteExpiresAt, language) })}
        </Text>
      </View>

      <SectionTitle icon="notifications-circle-outline" title={t("home.roleNotifications")} />
      {roleNotifications.length === 0 ? (
        <View style={styles.panel}>
          <Text style={styles.bodyText} allowFontScaling>
            {t("home.noRoleNotifications")}
          </Text>
        </View>
      ) : (
        roleNotifications.map((notification) => (
          <RoleNotificationCard key={notification.id} notification={notification} language={language} t={t} />
        ))
      )}

      <SectionTitle icon="notifications-outline" title={t("home.notificationControls")} />
      {state.notificationPreferences.map((preference) => {
        const member = state.members.find((item) => item.id === preference.memberId);
        return (
          <View key={preference.memberId} style={styles.listItem}>
            <View style={styles.listText}>
              <Text style={styles.itemTitle} allowFontScaling>
                {member ? memberDisplayName(member, t) : t("member.unknown")}
              </Text>
              <Text style={styles.itemMeta} allowFontScaling>
                {t("home.quietCritical", {
                  start: preference.quietHoursStart,
                  end: preference.quietHoursEnd
                })}
              </Text>
            </View>
            <View style={styles.preferenceActions}>
              <Pill
                tone={preference.taskDigest ? "safe" : "muted"}
                text={preference.taskDigest ? t("home.digestOn") : t("home.digestOff")}
              />
              <TouchableOpacity
                style={styles.smallIconButton}
                accessibilityRole="button"
                accessibilityLabel={t("home.toggleDigest", {
                  name: member ? memberDisplayName(member, t) : t("member.unknown")
                })}
                onPress={() => onToggleDigest(preference.memberId)}
              >
                <Ionicons name="options-outline" size={18} color={palette.teal} />
              </TouchableOpacity>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function renderTasks(
  state: AppState,
  actor: Member,
  language: Language,
  t: Translate,
  onCreateTaskFromTemplate: (templateKey: TaskTemplateKey) => void,
  onClaim: (task: Task) => void,
  onReject: (task: Task) => void,
  onHandoff: (task: Task) => void,
  onComplete: (task: Task) => void,
  onDeleteTask: (task: Task) => void,
  onOpenCustomTask: () => void
) {
  const canCreateTask = hasPermission(state, actor.role, "task:create");

  return (
    <View>
      {canCreateTask && (
        <>
          <SectionTitle icon="reader-outline" title={t("tasks.newRequest")} />
          <View style={styles.panel}>
            <Text style={styles.bodyText} allowFontScaling>
              {t("tasks.newRequestCopy")}
            </Text>
            <View style={styles.templateGrid}>
              {taskTemplateKeys.map((templateKey) => (
                <TouchableOpacity
                  key={templateKey}
                  style={styles.templateButton}
                  accessibilityRole="button"
                  accessibilityLabel={t("tasks.createTemplate", { name: taskTemplateLabel(templateKey, t) })}
                  onPress={() => onCreateTaskFromTemplate(templateKey)}
                >
                  <View style={styles.templateIcon}>
                    <Ionicons name={taskTemplateIcon(templateKey)} size={18} color={palette.surface} />
                  </View>
                  <View style={styles.listText}>
                    <Text style={styles.templateTitle} allowFontScaling>
                      {taskTemplateLabel(templateKey, t)}
                    </Text>
                    <Text style={styles.itemMeta} allowFontScaling>
                      {taskTemplateMeta(templateKey, t)}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
            {canCreateTask && (
              <TouchableOpacity
                style={styles.templateButton}
                accessibilityRole="button"
                accessibilityLabel={t("tasks.customTask")}
                onPress={onOpenCustomTask}
              >
                <View style={styles.templateIcon}>
                  <Ionicons name="create-outline" size={18} color={palette.surface} />
                </View>
                <View style={styles.listText}>
                  <Text style={styles.templateTitle} allowFontScaling>
                    {t("tasks.customTask")}
                  </Text>
                </View>
              </TouchableOpacity>
            )}
          </View>
        </>
      )}
      <SectionTitle icon="list-outline" title={t("tasks.claimableWork")} />
      {state.tasks.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          state={state}
          actor={actor}
          language={language}
          t={t}
          onClaim={() => onClaim(task)}
          onReject={() => onReject(task)}
          onHandoff={() => onHandoff(task)}
          onComplete={() => onComplete(task)}
          onDelete={() => onDeleteTask(task)}
        />
      ))}
    </View>
  );
}

function renderTimeline(
  state: AppState,
  actor: Member,
  filteredEvents: AppState["events"],
  eventType: "all" | EventType,
  setEventType: (eventType: "all" | EventType) => void,
  memberFilter: string,
  setMemberFilter: (memberId: string) => void,
  language: Language,
  t: Translate,
  onCreateTimelineEvent: (templateKey: TimelineTemplateKey) => void,
  onDeleteEvent: (eventId: string) => void,
  onOpenOtherUpdate: () => void
) {
  const canAddTimeline = hasPermission(state, actor.role, "timeline:add");

  return (
    <View>
      {canAddTimeline && (
        <>
          <SectionTitle icon="time-outline" title={t("timeline.quickUpdate")} />
          <View style={styles.panel}>
            <Text style={styles.bodyText} allowFontScaling>
              {t("timeline.quickUpdateCopy")}
            </Text>
            <View style={styles.templateGrid}>
              {timelineTemplateKeys.map((templateKey) => (
                <TouchableOpacity
                  key={templateKey}
                  style={styles.templateButton}
                  accessibilityRole="button"
                  accessibilityLabel={t("timeline.addTemplate", { name: timelineTemplateLabel(templateKey, t) })}
                  onPress={() => onCreateTimelineEvent(templateKey)}
                >
                  <View style={styles.templateIcon}>
                    <Ionicons name={timelineTemplateIcon(templateKey)} size={18} color={palette.surface} />
                  </View>
                  <View style={styles.listText}>
                    <Text style={styles.templateTitle} allowFontScaling>
                      {timelineTemplateLabel(templateKey, t)}
                    </Text>
                    <Text style={styles.itemMeta} allowFontScaling>
                      {timelineTemplateMeta(templateKey, t)}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
            {canAddTimeline && (
              <TouchableOpacity
                style={styles.templateButton}
                accessibilityRole="button"
                accessibilityLabel={t("timeline.otherUpdate")}
                onPress={onOpenOtherUpdate}
              >
                <View style={styles.templateIcon}>
                  <Ionicons name="create-outline" size={18} color={palette.surface} />
                </View>
                <View style={styles.listText}>
                  <Text style={styles.templateTitle} allowFontScaling>
                    {t("timeline.otherUpdate")}
                  </Text>
                </View>
              </TouchableOpacity>
            )}
          </View>
        </>
      )}

      <SectionTitle icon="filter-outline" title={t("timeline.filters")} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {eventTypes.map((type) => (
          <FilterChip
            key={type}
            label={eventTypeLabel(type, t)}
            active={eventType === type}
            onPress={() => setEventType(type)}
          />
        ))}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        <FilterChip
          label={t("timeline.allMembers")}
          active={memberFilter === "all"}
          onPress={() => setMemberFilter("all")}
        />
        {state.members.map((member) => (
          <FilterChip
            key={member.id}
            label={memberDisplayName(member, t)}
            active={memberFilter === member.id}
            onPress={() => setMemberFilter(member.id)}
          />
        ))}
      </ScrollView>

      <SectionTitle icon="time-outline" title={t("timeline.careTimeline")} />
      {filteredEvents.map((event) => {
        const canDeleteEvent = actor.role === "coordinator" || event.ownerId === actor.id;
        return (
          <View key={event.id} style={styles.timelineItem}>
            <View style={styles.timelineMarker}>
              <Ionicons name={eventIcon(event.type)} size={18} color={palette.surface} />
            </View>
            <View style={styles.timelineBody}>
              <Text style={styles.itemTitle} allowFontScaling>
                {eventTitle(event, state, t)}
              </Text>
              <Text style={styles.itemMeta} allowFontScaling>
                {t("timeline.eventMeta", {
                  date: formatDateTime(event.startsAt, language),
                  location: eventLocation(event, t)
                })}
              </Text>
              <Text style={styles.itemMeta} allowFontScaling>
                {t("tasks.owner", { name: memberName(state, event.ownerId, t) })}
              </Text>
            </View>
            {canDeleteEvent && (
              <TouchableOpacity
                style={styles.smallIconButton}
                accessibilityRole="button"
                accessibilityLabel={t("timeline.delete")}
                onPress={() => onDeleteEvent(event.id)}
              >
                <Ionicons name="trash-outline" size={18} color={palette.red} />
              </TouchableOpacity>
            )}
          </View>
        );
      })}
    </View>
  );
}

function renderDocuments(
  state: AppState,
  actor: Member,
  language: Language,
  t: Translate,
  documentSafetyConfirmed: boolean,
  onToggleDocumentSafety: () => void,
  onPickDocument: () => void,
  onConfirmDocument: (documentId: string) => void
) {
  return (
    <View>
      <SectionTitle icon="cloud-upload-outline" title={t("documents.basicUploads")} />
      <View style={styles.notice}>
        <Ionicons name="information-circle-outline" size={20} color={palette.blue} />
        <Text style={styles.noticeText} allowFontScaling>
          {t("documents.notice", { name: actor.name })}
        </Text>
      </View>
      {ocrProviderName === "mock" && (
        <View style={styles.notice}>
          <Ionicons name="flask-outline" size={20} color={palette.amber} />
          <Text style={styles.noticeText} allowFontScaling>
            {t("documents.ocrDemoNotice")}
          </Text>
        </View>
      )}
      <TouchableOpacity
        style={[styles.safetyToggle, documentSafetyConfirmed && styles.safetyToggleActive]}
        accessibilityRole="button"
        accessibilityState={{ selected: documentSafetyConfirmed }}
        accessibilityLabel={t("documents.safetyConfirm")}
        onPress={onToggleDocumentSafety}
      >
        <Ionicons
          name={documentSafetyConfirmed ? "checkmark-circle-outline" : "ellipse-outline"}
          size={20}
          color={documentSafetyConfirmed ? palette.teal : palette.gray}
        />
        <Text style={styles.safetyToggleText} allowFontScaling>
          {t("documents.safetyConfirm")}
        </Text>
      </TouchableOpacity>
      <View style={styles.actionRow}>
        <ActionButton icon="attach-outline" label={t("documents.upload")} tone="primary" onPress={onPickDocument} />
      </View>

      {state.documents.map((document) => (
        <View key={document.id} style={styles.panel}>
          <View style={styles.panelHeader}>
            <View style={styles.listText}>
              <Text style={styles.itemTitle} allowFontScaling>
                {documentName(document.id, document.name, document.source, t)}
              </Text>
              <Text style={styles.itemMeta} allowFontScaling>
                {t("documents.uploadedBy", {
                  name: memberName(state, document.uploadedById, t),
                  date: formatDateTime(document.uploadedAt, language)
                })}
              </Text>
            </View>
            <Pill
              tone={document.status === "confirmed" ? "safe" : "warning"}
              text={documentStatusLabel(document.status, t)}
            />
          </View>
          <Text style={styles.bodyText} allowFontScaling>
            {t("documents.ocr", { confidence: Math.round(document.confidence * 100) })}
          </Text>
          <Text style={styles.bodyText} allowFontScaling>
            {t("documents.suggestedAction", {
              action: documentSuggestedAction(document.id, document.suggestedAction, t)
            })}
          </Text>
          {document.rawText ? (
            <View style={styles.ocrTextBox}>
              <Text style={styles.itemMeta} allowFontScaling>
                {t("documents.ocrText")}
              </Text>
              <Text style={styles.ocrText} numberOfLines={6} allowFontScaling>
                {document.rawText}
              </Text>
            </View>
          ) : null}
          {document.status !== "confirmed" && (
            <ActionButton
              icon="checkmark-circle-outline"
              label={t("documents.confirmCreateTask")}
              tone="primary"
              onPress={() => onConfirmDocument(document.id)}
            />
          )}
        </View>
      ))}
    </View>
  );
}

function renderAudit(state: AppState, language: Language, t: Translate, onBack: () => void) {
  return (
    <View>
      <View style={styles.backBar}>
        <TouchableOpacity
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel={t("audit.back")}
          onPress={onBack}
        >
          <Ionicons name="arrow-back-outline" size={18} color={palette.teal} />
          <Text style={styles.backButtonText} allowFontScaling>
            {t("audit.back")}
          </Text>
        </TouchableOpacity>
      </View>
      <SectionTitle icon="shield-checkmark-outline" title={t("audit.trail")} />
      {state.auditEvents.map((event) => (
        <View key={event.id} style={styles.auditItem}>
          <View style={styles.auditIcon}>
            <Ionicons name="finger-print-outline" size={18} color={palette.teal} />
          </View>
          <View style={styles.listText}>
            <Text style={styles.itemTitle} allowFontScaling>
              {auditActionLabel(event.action, t)}
            </Text>
            <Text style={styles.itemMeta} allowFontScaling>
              {formatDateTime(event.createdAt, language)} - {memberName(state, event.actorId, t)}
            </Text>
            <Text style={styles.bodyText} allowFontScaling>
              {auditDetail(event.action, event.detail, event.actorId, event.entityId, state, t)}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function renderSettings(
  state: AppState,
  actor: Member,
  language: Language,
  t: Translate,
  report: string,
  onGenerateReport: () => void,
  onOpenRoleEditor: (memberId: string) => void,
  inviteExpired: boolean,
  onViewAllAudit: () => void,
  isCloud: boolean,
  onOpenHouseholds: (() => void) | undefined,
  onOpenLegal: (kind: "privacy" | "terms") => void,
  plan: Plan,
  onOpenPaywall: () => void,
  onDeleteAccount?: () => void,
  joinCode?: HouseholdCode | null,
  onGenerateCode?: () => void,
  onRemoveMember?: (memberId: string) => void,
  onLeaveHousehold?: () => void,
  onDissolveHousehold?: () => void,
  onOpenNameEditor?: () => void
) {
  const canManageRoles = hasPermission(state, actor.role, "member:role_update");
  const canGenerateReport = hasPermission(state, actor.role, "report:export");
  const canReadAudit = hasPermission(state, actor.role, "audit:read");
  const completed = state.tasks.filter((task) => task.status === "completed");
  const pending = state.tasks.filter((task) => task.status !== "completed");
  const recentAuditEvents = state.auditEvents.slice(0, 4);
  const settingsMembers = orderMembersForDisplay(
    canManageRoles ? state.members : state.members.filter((member) => member.id === actor.id),
    actor.id
  );

  return (
    <View>
      <SectionTitle icon="settings-outline" title={t("settings.title")} />
      <View style={styles.notice}>
        <Ionicons name="apps-outline" size={20} color={palette.blue} />
        <Text style={styles.noticeText} allowFontScaling>
          {t("settings.sameApp")}
        </Text>
      </View>
      <View style={styles.notice}>
        <Ionicons name="phone-portrait-outline" size={20} color={palette.teal} />
        <Text style={styles.noticeText} allowFontScaling>
          {isCloud ? t("settings.cloudSync") : t("settings.localSave")}
        </Text>
      </View>

      {onOpenHouseholds && (
        <>
          <SectionTitle icon="home-outline" title={t("households.title")} />
          <View style={styles.panel}>
            <Text style={styles.bodyText} allowFontScaling>
              {t("households.current", { name: state.household.name })}
            </Text>
            <ActionButton
              icon="swap-horizontal-outline"
              label={t("households.manage")}
              tone="secondary"
              onPress={onOpenHouseholds}
            />
          </View>
        </>
      )}

      <SectionTitle icon="ribbon-outline" title={t("settings.plan")} />
      <View style={styles.panel}>
        <View style={styles.panelHeader}>
          <View style={styles.listText}>
            <Text style={styles.itemTitle} allowFontScaling>
              {plan === "free" ? t("plan.free") : t("plan.plus")}
            </Text>
            <Text style={styles.itemMeta} allowFontScaling>
              {t("paywall.currentPlan")}
            </Text>
          </View>
          <Ionicons name={plan === "free" ? "ribbon-outline" : "ribbon"} size={22} color={palette.teal} />
        </View>
        <ActionButton
          icon={plan === "free" ? "star-outline" : "settings-outline"}
          label={plan === "free" ? t("settings.upgrade") : t("settings.managePlan")}
          tone="primary"
          onPress={onOpenPaywall}
        />
      </View>

      {canManageRoles && (
        <>
          <SectionTitle icon="qr-code-outline" title={t("settings.joinCodeTitle")} />
          <View style={styles.panel}>
            <Text style={styles.bodyText} allowFontScaling>
              {t("settings.joinCodeCopy")}
            </Text>
            {joinCode ? (
              <>
                <QRCode value={Linking.createURL("join", { queryParams: { code: joinCode.code } })} size={200} />
                <TouchableOpacity
                  style={styles.codeBox}
                  accessibilityRole="button"
                  accessibilityLabel={t("settings.codeCopied")}
                  onPress={() => {
                    Clipboard.setStringAsync(joinCode.code);
                    showMessage(t("settings.codeCopied"), joinCode.code);
                  }}
                >
                  <Text style={styles.codeText} allowFontScaling>
                    {joinCode.code}
                  </Text>
                </TouchableOpacity>
                <Text style={styles.itemMeta} allowFontScaling>
                  {t("settings.codeExpires", { date: formatDateTime(joinCode.expiresAt, language) })}
                </Text>
                <ActionButton
                  icon="refresh-outline"
                  label={t("settings.refreshCode")}
                  tone="secondary"
                  onPress={() => onGenerateCode?.()}
                />
              </>
            ) : (
              <ActionButton
                icon="add-circle-outline"
                label={t("settings.generateCode")}
                tone="primary"
                onPress={() => onGenerateCode?.()}
              />
            )}
          </View>
        </>
      )}

      <SectionTitle icon="people-circle-outline" title={t("settings.roleManagement")} />
      {settingsMembers.map((member) => {
        const isSelf = member.id === actor.id;
        const memberRelationLabel = memberRelation(member, t);
        const memberMeta = [memberRelationLabel, t("settings.currentRole", { role: roleLabel(member.role, t) })]
          .filter(Boolean)
          .join(" - ");
        return (
          <View key={member.id} style={styles.panel}>
            <View style={styles.panelHeader}>
              <View style={styles.listText}>
                <Text style={styles.itemTitle} allowFontScaling>
                  {memberDisplayName(member, t)}
                </Text>
                <Text style={styles.itemMeta} allowFontScaling>
                  {memberMeta}
                </Text>
              </View>
              <Pill tone={member.role === "viewer" ? "muted" : "info"} text={roleLabel(member.role, t)} />
            </View>
            {member.inviteStatus === "pending" && <Pill tone="warning" text={t("settings.pendingInvite")} />}

            {canManageRoles && !isSelf && (
              <View style={styles.settingsInlineActions}>
                <TouchableOpacity
                  style={[styles.roleChangeButton, styles.settingsInlineButton]}
                  accessibilityRole="button"
                  accessibilityLabel={t("settings.changeRoleButtonFor", { name: memberDisplayName(member, t) })}
                  onPress={() => onOpenRoleEditor(member.id)}
                >
                  <Ionicons name="swap-horizontal-outline" size={17} color={palette.teal} />
                  <Text style={styles.roleChangeButtonText} allowFontScaling>
                    {t("settings.changeRoleButton")}
                  </Text>
                </TouchableOpacity>
                {onRemoveMember && (
                  <TouchableOpacity
                    style={[styles.roleChangeButton, styles.settingsInlineButton, { borderColor: palette.red }]}
                    accessibilityRole="button"
                    accessibilityLabel={t("settings.removeMember")}
                    onPress={() => onRemoveMember(member.id)}
                  >
                    <Ionicons name="trash-outline" size={17} color={palette.red} />
                    <Text style={[styles.roleChangeButtonText, { color: palette.red }]} allowFontScaling>
                      {t("settings.removeMember")}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            <Text style={styles.itemMeta} allowFontScaling>
              {isSelf && !canManageRoles
                ? t("settings.ownRoleManaged")
                : isSelf
                  ? t("settings.selfLocked")
                  : canManageRoles
                    ? t("settings.permissionsFor", { role: roleLabel(member.role, t) })
                    : t("settings.viewOnly")}
            </Text>
            <View style={styles.permissionWrap}>
              {roleCapabilityLabels(member.role, t).map((capability) => (
                <View key={capability} style={styles.permissionChip}>
                  <Ionicons name="checkmark-circle-outline" size={14} color={palette.blue} />
                  <Text style={styles.permissionText} allowFontScaling>
                    {capability}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        );
      })}

      {(canGenerateReport || canReadAudit) && <SectionTitle icon="construct-outline" title={t("settings.advanced")} />}

      {canGenerateReport && (
        <View style={styles.panel}>
          <View style={styles.panelHeader}>
            <View style={styles.listText}>
              <Text style={styles.itemTitle} allowFontScaling>
                {t("settings.weeklyReport")}
              </Text>
              <Text style={styles.itemMeta} allowFontScaling>
                {t("report.explainer")}
              </Text>
            </View>
            <Ionicons name="reader-outline" size={22} color={palette.teal} />
          </View>
          <View style={styles.reportStats}>
            <Metric
              label={t("report.done")}
              value={String(completed.length)}
              icon="checkmark-done-outline"
              tone="green"
            />
            <Metric label={t("report.pending")} value={String(pending.length)} icon="hourglass-outline" tone="amber" />
          </View>
          <ActionButton icon="share-outline" label={t("report.generate")} tone="primary" onPress={onGenerateReport} />
          {report.length > 0 && (
            <Text style={styles.reportPreview} numberOfLines={5} allowFontScaling>
              {report}
            </Text>
          )}
        </View>
      )}

      {canReadAudit && (
        <View style={styles.panel}>
          <View style={styles.panelHeader}>
            <View style={styles.listText}>
              <Text style={styles.itemTitle} allowFontScaling>
                {t("settings.recentAudit")}
              </Text>
              <Text style={styles.itemMeta} allowFontScaling>
                {t("settings.auditSummary")}
              </Text>
            </View>
            <Ionicons name="shield-checkmark-outline" size={22} color={palette.teal} />
          </View>
          {recentAuditEvents.length === 0 ? (
            <Text style={styles.bodyText} allowFontScaling>
              {t("settings.auditEmpty")}
            </Text>
          ) : (
            recentAuditEvents.map((event) => (
              <View key={event.id} style={styles.compactAuditItem}>
                <Ionicons name="finger-print-outline" size={16} color={palette.teal} />
                <View style={styles.listText}>
                  <Text style={styles.itemTitle} allowFontScaling>
                    {auditActionLabel(event.action, t)}
                  </Text>
                  <Text style={styles.itemMeta} allowFontScaling>
                    {formatDateTime(event.createdAt, language)} - {memberName(state, event.actorId, t)}
                  </Text>
                </View>
              </View>
            ))
          )}
          {state.auditEvents.length > 0 && (
            <TouchableOpacity
              style={styles.roleChangeButton}
              accessibilityRole="button"
              accessibilityLabel={t("settings.viewAllAudit")}
              onPress={onViewAllAudit}
            >
              <Ionicons name="chevron-forward-outline" size={17} color={palette.teal} />
              <Text style={styles.roleChangeButtonText} allowFontScaling>
                {t("settings.viewAllAudit")}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <SectionTitle icon="exit-outline" title={state.household.name} />
      <View style={styles.panel}>
        <View style={styles.settingsInlineActions}>
          {onOpenNameEditor && (
            <TouchableOpacity
              style={[styles.roleChangeButton, styles.settingsInlineButton]}
              accessibilityRole="button"
              accessibilityLabel={t("settings.updateName")}
              onPress={onOpenNameEditor}
            >
              <Ionicons name="person-outline" size={17} color={palette.teal} />
              <Text style={styles.roleChangeButtonText} allowFontScaling>
                {t("settings.updateName")}
              </Text>
            </TouchableOpacity>
          )}
          {canManageRoles
            ? onDissolveHousehold && (
                <TouchableOpacity
                  style={[styles.roleChangeButton, styles.settingsInlineButton, { borderColor: palette.red }]}
                  accessibilityRole="button"
                  accessibilityLabel={t("settings.dissolveHousehold")}
                  onPress={() => onDissolveHousehold?.()}
                >
                  <Ionicons name="trash-outline" size={17} color={palette.red} />
                  <Text style={[styles.roleChangeButtonText, { color: palette.red }]} allowFontScaling>
                    {t("settings.dissolveHousehold")}
                  </Text>
                </TouchableOpacity>
              )
            : onLeaveHousehold && (
                <TouchableOpacity
                  style={[styles.roleChangeButton, styles.settingsInlineButton, { borderColor: palette.red }]}
                  accessibilityRole="button"
                  accessibilityLabel={t("settings.leaveHousehold")}
                  onPress={() => onLeaveHousehold?.()}
                >
                  <Ionicons name="log-out-outline" size={17} color={palette.red} />
                  <Text style={[styles.roleChangeButtonText, { color: palette.red }]} allowFontScaling>
                    {t("settings.leaveHousehold")}
                  </Text>
                </TouchableOpacity>
              )}
        </View>
      </View>

      <SectionTitle icon="document-text-outline" title={t("settings.legalTitle")} />
      <View style={styles.panel}>
        <View style={styles.settingsInlineActions}>
          <TouchableOpacity
            style={[styles.roleChangeButton, styles.settingsInlineButton]}
            accessibilityRole="button"
            accessibilityLabel={t("settings.openPrivacy")}
            onPress={() => onOpenLegal("privacy")}
          >
            <Ionicons name="shield-outline" size={17} color={palette.teal} />
            <Text style={styles.roleChangeButtonText} allowFontScaling>
              {t("settings.openPrivacy")}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.roleChangeButton, styles.settingsInlineButton]}
            accessibilityRole="button"
            accessibilityLabel={t("settings.openTerms")}
            onPress={() => onOpenLegal("terms")}
          >
            <Ionicons name="document-text-outline" size={17} color={palette.teal} />
            <Text style={styles.roleChangeButtonText} allowFontScaling>
              {t("settings.openTerms")}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {onDeleteAccount && (
        <View style={styles.panel}>
          <TouchableOpacity
            style={[styles.roleChangeButton, styles.deleteButton]}
            accessibilityRole="button"
            accessibilityLabel={t("settings.deleteAccount")}
            onPress={onDeleteAccount}
          >
            <Ionicons name="trash-outline" size={17} color={palette.red} />
            <Text style={[styles.roleChangeButtonText, { color: palette.red }]} allowFontScaling>
              {t("settings.deleteAccount")}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function buildHomeActions(
  state: AppState,
  actor: Member,
  metrics: { open: number; completed: number; ownerRate: number; criticalOpen: number },
  language: Language,
  t: Translate,
  onClaimTask: (task: Task) => void,
  onCompleteTask: (task: Task) => void,
  onOpenTab: (tab: TabKey) => void,
  onGenerateReport: () => void
): {
  id: string;
  icon: IconName;
  title: string;
  meta: string;
  buttonIcon: IconName;
  buttonLabel: string;
  buttonTone: "primary" | "secondary" | "success";
  onPress: () => void;
}[] {
  const actions: {
    id: string;
    icon: IconName;
    title: string;
    meta: string;
    buttonIcon: IconName;
    buttonLabel: string;
    buttonTone: "primary" | "secondary" | "success";
    onPress: () => void;
  }[] = [];
  const orderedTasks = [...state.tasks].sort(
    (left, right) => new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime()
  );
  const canClaim = hasPermission(state, actor.role, "task:claim");
  const canComplete = hasPermission(state, actor.role, "task:complete");
  const canReadDocuments = hasPermission(state, actor.role, "document:read");
  const canAddTimeline = hasPermission(state, actor.role, "timeline:add");
  const canGenerateReport = hasPermission(state, actor.role, "report:export");

  const handoffTask = orderedTasks.find((task) => task.status === "handoff_requested" && task.handoffToId === actor.id);
  if (handoffTask && canClaim) {
    actions.push({
      id: `handoff-${handoffTask.id}`,
      icon: "swap-horizontal-outline",
      title: t("home.actionAcceptHandoff", { task: taskTitle(handoffTask, t) }),
      meta: t("home.actionDue", { date: formatDateTime(handoffTask.dueAt, language) }),
      buttonIcon: "checkmark-circle-outline",
      buttonLabel: t("tasks.acceptHandoff"),
      buttonTone: "primary",
      onPress: () => onClaimTask(handoffTask)
    });
  }

  const ownedTask = orderedTasks.find((task) => task.status === "claimed" && task.ownerId === actor.id);
  if (ownedTask && canComplete) {
    actions.push({
      id: `owned-${ownedTask.id}`,
      icon: "checkbox-outline",
      title: t("home.actionCompleteTask", { task: taskTitle(ownedTask, t) }),
      meta: t("home.actionDue", { date: formatDateTime(ownedTask.dueAt, language) }),
      buttonIcon: "checkmark-circle-outline",
      buttonLabel: t("tasks.complete"),
      buttonTone: "success",
      onPress: () => onCompleteTask(ownedTask)
    });
  }

  const claimableTask = orderedTasks.find((task) => task.status === "open" || task.status === "rejected");
  if (claimableTask && canClaim) {
    actions.push({
      id: `claim-${claimableTask.id}`,
      icon: claimableTask.priority === "critical" ? "alert-circle-outline" : "hand-left-outline",
      title: t("home.actionClaimTask", { task: taskTitle(claimableTask, t) }),
      meta: t("home.actionDue", { date: formatDateTime(claimableTask.dueAt, language) }),
      buttonIcon: "hand-left-outline",
      buttonLabel: t("tasks.claim"),
      buttonTone: "primary",
      onPress: () => onClaimTask(claimableTask)
    });
  }

  const reviewDocument = state.documents.find((document) => document.status !== "confirmed");
  if (reviewDocument && canReadDocuments) {
    actions.push({
      id: `document-${reviewDocument.id}`,
      icon: "document-text-outline",
      title: t("home.actionReviewFile", {
        document: documentName(reviewDocument.id, reviewDocument.name, reviewDocument.source, t)
      }),
      meta: t("home.actionReviewFileMeta"),
      buttonIcon: "document-text-outline",
      buttonLabel: t("home.openDocs"),
      buttonTone: "secondary",
      onPress: () => onOpenTab("documents")
    });
  }

  if (canAddTimeline) {
    actions.push({
      id: "timeline-add",
      icon: "time-outline",
      title: t("home.actionAddTimeline"),
      meta: t("home.actionAddTimelineMeta"),
      buttonIcon: "add-circle-outline",
      buttonLabel: t("home.openTimeline"),
      buttonTone: "secondary",
      onPress: () => onOpenTab("timeline")
    });
  }

  if (canGenerateReport && metrics.open > 0) {
    actions.push({
      id: "report-generate",
      icon: "reader-outline",
      title: t("home.actionGenerateReport"),
      meta: t("home.actionGenerateReportMeta", { count: metrics.open }),
      buttonIcon: "share-outline",
      buttonLabel: t("report.generate"),
      buttonTone: "secondary",
      onPress: onGenerateReport
    });
  }

  if (actions.length === 0) {
    actions.push({
      id: "timeline-view",
      icon: "time-outline",
      title: t("home.actionViewTimeline"),
      meta: t("home.actionViewTimelineMeta"),
      buttonIcon: "time-outline",
      buttonLabel: t("home.openTimeline"),
      buttonTone: "secondary",
      onPress: () => onOpenTab("timeline")
    });
  }

  return actions.slice(0, 3);
}

function roleCapabilityLabels(role: Role, t: Translate): string[] {
  if (role === "coordinator") {
    return [
      t("capability.manage"),
      t("capability.coordinate"),
      t("capability.help"),
      t("capability.timelineUpdate"),
      t("capability.files"),
      t("capability.report"),
      t("capability.audit")
    ];
  }

  if (role === "caregiver") {
    return [
      t("capability.coordinate"),
      t("capability.help"),
      t("capability.timelineUpdate"),
      t("capability.files"),
      t("capability.report")
    ];
  }

  return [t("capability.timeline"), t("capability.viewOnly")];
}

function RoleNotificationCard({
  notification,
  language,
  t
}: {
  notification: RoleNotification;
  language: Language;
  t: Translate;
}) {
  const values = localizedNotificationValues(notification, t);

  return (
    <View style={styles.notificationCard}>
      <View style={styles.notificationIcon}>
        <Ionicons
          name={notification.severity === "critical" ? "alert-circle-outline" : "notifications-outline"}
          size={18}
          color={notification.severity === "critical" ? palette.red : palette.teal}
        />
      </View>
      <View style={styles.listText}>
        <View style={styles.notificationHeader}>
          <Text style={styles.itemTitle} allowFontScaling>
            {t(notification.titleKey, values)}
          </Text>
          <Pill
            tone={notification.severity === "critical" ? "danger" : "info"}
            text={notificationAudienceLabel(notification.audience, t)}
          />
        </View>
        <Text style={styles.bodyText} allowFontScaling>
          {t(notification.bodyKey, values)}
        </Text>
        <Text style={styles.itemMeta} allowFontScaling>
          {formatDateTime(notification.createdAt, language)}
        </Text>
      </View>
    </View>
  );
}

function localizedNotificationValues(notification: RoleNotification, t: Translate): Record<string, string | number> {
  const values = { ...notification.values };

  if (values.priority === "normal" || values.priority === "critical") {
    values.priority = priorityLabel(values.priority, t);
  }

  if (values.role === "coordinator" || values.role === "caregiver" || values.role === "viewer") {
    values.role = roleLabel(values.role, t);
  }

  if (values.role === "Coordinator" || values.role === "Caregiver" || values.role === "Viewer") {
    const legacyRole: Record<string, Role> = {
      Coordinator: "coordinator",
      Caregiver: "caregiver",
      Viewer: "viewer"
    };
    values.role = roleLabel(legacyRole[String(values.role)], t);
  }

  return values;
}

function notificationAudienceLabel(audience: RoleNotification["audience"], t: Translate): string {
  return audience === "all" ? t("notification.audience.all") : roleLabel(audience, t);
}

function TaskCard({
  task,
  state,
  actor,
  language,
  t,
  onClaim,
  onReject,
  onHandoff,
  onComplete,
  onDelete
}: {
  task: Task;
  state: AppState;
  actor: Member;
  language: Language;
  t: Translate;
  onClaim: () => void;
  onReject: () => void;
  onHandoff: () => void;
  onComplete: () => void;
  onDelete: () => void;
}) {
  const ownedByActor = task.ownerId === actor.id;
  const canClaim = hasPermission(state, actor.role, "task:claim");
  const canHandoff = hasPermission(state, actor.role, "task:handoff");
  const canComplete = hasPermission(state, actor.role, "task:complete");
  const canFinish = canComplete && (ownedByActor || actor.role === "coordinator");
  const canDelete = actor.role === "coordinator" || task.requestedById === actor.id || ownedByActor;
  const canRequestHandoff = canHandoff && (ownedByActor || actor.role === "coordinator");
  const canAcceptHandoff = canClaim && task.status === "handoff_requested" && task.handoffToId === actor.id;
  const canTakeOpenTask = task.status === "open" || task.status === "rejected";

  return (
    <View style={styles.taskCard}>
      <View style={styles.panelHeader}>
        <View style={styles.listText}>
          <Text style={styles.itemTitle} allowFontScaling>
            {taskTitle(task, t)}
          </Text>
          <Text style={styles.itemMeta} allowFontScaling>
            {t("tasks.dueMeta", { date: formatDateTime(task.dueAt, language), minutes: task.expectedMinutes })}
          </Text>
        </View>
        <Pill tone={task.priority === "critical" ? "danger" : "info"} text={priorityLabel(task.priority, t)} />
      </View>
      <View style={styles.taskMetaRow}>
        <Pill tone={task.status === "completed" ? "safe" : "muted"} text={taskStatusLabel(task.status, t)} />
        <Text style={styles.itemMeta} allowFontScaling>
          {t("tasks.owner", { name: memberName(state, task.ownerId, t) })}
        </Text>
      </View>
      {task.handoffToId && (
        <Text style={styles.itemMeta} allowFontScaling>
          {t("tasks.handoffRequested", { name: memberName(state, task.handoffToId, t) })}
        </Text>
      )}
      {task.rejectionReason && (
        <Text style={styles.warningText} allowFontScaling>
          {task.rejectionReason}
        </Text>
      )}
      {task.subtasks.map((subtask, index) => (
        <View key={subtask} style={styles.subtaskRow}>
          <Ionicons name="ellipse" size={8} color={palette.teal} />
          <Text style={styles.subtaskText} allowFontScaling>
            {taskSubtask(task, index, subtask, t)}
          </Text>
        </View>
      ))}
      {task.proof && (
        <Text style={styles.proofText} allowFontScaling>
          {t("tasks.proof", { value: task.proof })}
        </Text>
      )}
      <View style={styles.actionRow}>
        {task.status !== "completed" && canClaim && canTakeOpenTask && (
          <ActionButton icon="hand-left-outline" label={t("tasks.claim")} tone="primary" onPress={onClaim} />
        )}
        {task.status !== "completed" && canClaim && canTakeOpenTask && (
          <ActionButton icon="close-circle-outline" label={t("tasks.reject")} tone="secondary" onPress={onReject} />
        )}
        {task.status === "claimed" && canRequestHandoff && (
          <ActionButton
            icon="swap-horizontal-outline"
            label={t("tasks.handoff")}
            tone="secondary"
            onPress={onHandoff}
          />
        )}
        {canAcceptHandoff && (
          <ActionButton
            icon="checkmark-circle-outline"
            label={t("tasks.acceptHandoff")}
            tone="primary"
            onPress={onClaim}
          />
        )}
        {canAcceptHandoff && (
          <ActionButton
            icon="close-circle-outline"
            label={t("tasks.declineHandoff")}
            tone="secondary"
            onPress={onReject}
          />
        )}
        {task.status !== "completed" && canFinish && (
          <ActionButton
            icon="checkmark-circle-outline"
            label={t("tasks.complete")}
            tone="success"
            onPress={onComplete}
          />
        )}
        {canDelete && (
          <ActionButton icon="trash-outline" label={t("tasks.delete")} tone="secondary" onPress={onDelete} />
        )}
      </View>
    </View>
  );
}

function memberRelation(member: Member, t: Translate): string {
  const relation = member.relation?.trim() ?? "";

  if (relation === "Pending invite") {
    return t("member.pendingInvite");
  }

  const keys: Record<string, string> = {
    "m-maya": "member.primaryCaregiver",
    "m-eli": "member.remoteSibling",
    "m-sam": "member.neighborHelper",
    "m-lee": "member.readOnlyRelative"
  };

  return keys[member.id] ? t(keys[member.id]) : relation;
}

function memberDisplayName(member: Member, t: Translate): string {
  if (member.inviteStatus === "pending") {
    return member.role === "caregiver" ? t("member.invitedCaregiver") : t("member.invitedViewer");
  }

  return member.name;
}

function memberAvailability(member: Member, t: Translate): string {
  const availability = member.availability?.trim() ?? "";

  if (availability === "Pending setup") {
    return t("availability.pendingSetup");
  }

  const keys: Record<string, string> = {
    "m-maya": "availability.maya",
    "m-eli": "availability.eli",
    "m-sam": "availability.sam",
    "m-lee": "availability.lee"
  };

  return keys[member.id] ? t(keys[member.id]) : availability;
}

function taskTitle(task: Task, t: Translate): string {
  if (task.id.startsWith("task-") && task.documentId) {
    return t("task.dynamic.documentReview");
  }

  const key = `task.${task.id}.title`;
  const translated = t(key);
  return translated === key ? task.title : translated;
}

function taskSubtask(task: Task, index: number, fallback: string, t: Translate): string {
  if (task.id.startsWith("task-") && task.documentId) {
    return t(`task.dynamic.subtask.${index}`);
  }

  const key = `task.${task.id}.subtask.${index}`;
  const translated = t(key);
  return translated === key ? fallback : translated;
}

function eventTitle(event: CareEvent, state: AppState, t: Translate): string {
  const knownKey = `event.${event.id}.title`;
  const knownTitle = t(knownKey);
  if (knownTitle !== knownKey) {
    return knownTitle;
  }

  if (event.documentId) {
    const document = state.documents.find((item) => item.id === event.documentId);
    return t("event.uploaded", {
      name: documentName(document?.id, document?.name ?? event.title.replace(/^Uploaded: /, ""), document?.source, t)
    });
  }

  if (event.taskId && event.type === "reminder") {
    const task = state.tasks.find((item) => item.id === event.taskId);
    return t("event.completed", { title: task ? taskTitle(task, t) : "Task" });
  }

  return event.title;
}

function eventLocation(event: CareEvent, t: Translate): string {
  const knownKey = `event.${event.id}.location`;
  const knownLocation = t(knownKey);
  if (knownLocation !== knownKey) {
    return knownLocation;
  }

  if (event.location === "Shared documents") {
    return t("event.location.sharedDocuments");
  }

  if (event.location === "TaskKin Care activity") {
    return t("event.location.activity");
  }

  return event.location;
}

function documentName(
  documentId: string | undefined,
  fallback: string,
  source: DocumentRecord["source"] | undefined,
  t: Translate
): string {
  if (documentId === "d-discharge") {
    return t("document.d-discharge.name");
  }

  if (source === "sample") {
    return t("document.sampleName");
  }

  return fallback;
}

function documentSuggestedAction(documentId: string, fallback: string | undefined, t: Translate): string {
  if (documentId === "d-discharge") {
    return t("document.d-discharge.action");
  }

  return fallback ?? t("task.dynamic.documentReview");
}

function taskTemplateLabel(templateKey: TaskTemplateKey, t: Translate): string {
  return {
    ride: t("tasks.templateRide"),
    paperwork: t("tasks.templatePaperwork"),
    supplies: t("tasks.templateSupplies")
  }[templateKey];
}

function taskTemplateMeta(templateKey: TaskTemplateKey, t: Translate): string {
  return {
    ride: t("tasks.templateRideMeta"),
    paperwork: t("tasks.templatePaperworkMeta"),
    supplies: t("tasks.templateSuppliesMeta")
  }[templateKey];
}

function taskTemplateIcon(templateKey: TaskTemplateKey): IconName {
  const icons: Record<TaskTemplateKey, IconName> = {
    ride: "car-outline",
    paperwork: "call-outline",
    supplies: "bag-handle-outline"
  };

  return icons[templateKey];
}

function timelineTemplateLabel(templateKey: TimelineTemplateKey, t: Translate): string {
  return {
    checkin: t("timeline.templateCheckin"),
    pickup: t("timeline.templatePickup"),
    paperwork: t("timeline.templatePaperwork")
  }[templateKey];
}

function timelineTemplateMeta(templateKey: TimelineTemplateKey, t: Translate): string {
  return {
    checkin: t("timeline.templateCheckinMeta"),
    pickup: t("timeline.templatePickupMeta"),
    paperwork: t("timeline.templatePaperworkMeta")
  }[templateKey];
}

function timelineTemplateIcon(templateKey: TimelineTemplateKey): IconName {
  const icons: Record<TimelineTemplateKey, IconName> = {
    checkin: "chatbubble-ellipses-outline",
    pickup: "car-outline",
    paperwork: "document-text-outline"
  };

  return icons[templateKey];
}

function timelineTemplateInput(
  templateKey: TimelineTemplateKey,
  t: Translate
): Pick<CareEvent, "type" | "title" | "startsAt" | "location"> {
  const now = Date.now();
  const inputs: Record<TimelineTemplateKey, Pick<CareEvent, "type" | "title" | "startsAt" | "location">> = {
    checkin: {
      type: "visit",
      title: t("timeline.templateCheckinTitle"),
      startsAt: new Date(now).toISOString(),
      location: t("event.location.activity")
    },
    pickup: {
      type: "transport",
      title: t("timeline.templatePickupTitle"),
      startsAt: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
      location: t("event.location.activity")
    },
    paperwork: {
      type: "document",
      title: t("timeline.templatePaperworkTitle"),
      startsAt: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
      location: t("event.location.sharedDocuments")
    }
  };

  return inputs[templateKey];
}

function taskTemplateInput(
  templateKey: TaskTemplateKey,
  t: Translate
): Pick<Task, "title" | "expectedMinutes" | "dueAt" | "priority" | "subtasks"> {
  const now = Date.now();
  const inputs: Record<TaskTemplateKey, Pick<Task, "title" | "expectedMinutes" | "dueAt" | "priority" | "subtasks">> = {
    ride: {
      title: t("task.template.ride.title"),
      expectedMinutes: 20,
      dueAt: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
      priority: "critical",
      subtasks: [
        t("task.template.ride.subtask.0"),
        t("task.template.ride.subtask.1"),
        t("task.template.ride.subtask.2")
      ]
    },
    paperwork: {
      title: t("task.template.paperwork.title"),
      expectedMinutes: 15,
      dueAt: new Date(now + 36 * 60 * 60 * 1000).toISOString(),
      priority: "normal",
      subtasks: [t("task.template.paperwork.subtask.0"), t("task.template.paperwork.subtask.1")]
    },
    supplies: {
      title: t("task.template.supplies.title"),
      expectedMinutes: 35,
      dueAt: new Date(now + 30 * 60 * 60 * 1000).toISOString(),
      priority: "normal",
      subtasks: [t("task.template.supplies.subtask.0"), t("task.template.supplies.subtask.1")]
    }
  };

  return inputs[templateKey];
}

function auditDetail(
  action: AuditAction,
  fallback: string,
  actorId: string,
  entityId: string,
  state: AppState,
  t: Translate
): string {
  const actor = memberName(state, actorId, t);
  const task = state.tasks.find((item) => item.id === entityId);
  const memberTarget = state.members.find((item) => item.id === entityId);
  const target =
    action === "member.role_updated"
      ? memberName(state, entityId, t)
      : task?.handoffToId
        ? memberName(state, task.handoffToId, t)
        : t("member.unknown");
  const role = memberTarget ? roleLabel(memberTarget.role, t) : t("member.unknown");
  const title = task ? taskTitle(task, t) : fallback;
  const key = `audit.detail.${action}`;
  const translated = t(key, { actor, target, role, title });
  return translated === key ? fallback : translated;
}

function generateLocalizedWeeklyReport(
  state: AppState,
  actor: Member,
  language: Language,
  t: Translate
): { state: AppState; report: string } {
  const report = buildLocalizedReportText(state, language, t);

  return {
    report,
    state: withAudit(
      withRoleNotification(
        state,
        "coordinator",
        "info",
        "notification.title.reportGenerated",
        "notification.body.reportGenerated",
        { actor: actor.name },
        "report",
        `report-${Date.now()}`
      ),
      actor.id,
      "report.generated",
      "report",
      `report-${Date.now()}`,
      t("audit.detail.report.generated")
    )
  };
}

function buildLocalizedReportText(state: AppState, language: Language, t: Translate): string {
  const completed = state.tasks.filter((task) => task.status === "completed");
  const open = state.tasks.filter((task) => task.status !== "completed");
  const loadByMember = state.members
    .map((member) => {
      const count = state.tasks.filter((task) => task.ownerId === member.id && task.status !== "completed").length;
      return `${memberDisplayName(member, t)}: ${count}`;
    })
    .join(" | ");
  const upcoming =
    [...state.events]
      .sort((left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime())
      .slice(0, 3)
      .map((event) => `${formatDateTime(event.startsAt, language)} - ${eventTitle(event, state, t)}`)
      .join("\n") || t("report.noUpcoming");

  return [
    t("report.title"),
    t("report.household", { name: state.household.name }),
    t("report.completed", { count: completed.length }),
    t("report.open", { count: open.length }),
    t("report.load", { load: loadByMember }),
    t("report.upcoming"),
    upcoming,
    t("report.boundary")
  ].join("\n");
}

function Metric({
  label,
  value,
  icon,
  tone
}: {
  label: string;
  value: string;
  icon: IconName;
  tone: "blue" | "green" | "teal" | "red" | "amber";
}) {
  return (
    <View style={styles.metric}>
      <View style={[styles.metricIcon, { backgroundColor: toneColor(tone) }]}>
        <Ionicons name={icon} size={16} color={palette.surface} />
      </View>
      <View style={styles.metricText}>
        <Text style={styles.metricValue} allowFontScaling>
          {value}
        </Text>
        <Text style={styles.metricLabel} allowFontScaling>
          {label}
        </Text>
      </View>
    </View>
  );
}

function SectionTitle({ icon, title }: { icon: IconName; title: string }) {
  return (
    <View style={styles.sectionTitle}>
      <Ionicons name={icon} size={20} color={palette.teal} />
      <Text style={styles.sectionTitleText} allowFontScaling>
        {title}
      </Text>
    </View>
  );
}

function ActionButton({
  icon,
  label,
  tone,
  onPress
}: {
  icon: IconName;
  label: string;
  tone: "primary" | "secondary" | "success";
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.actionButton,
        tone === "primary" && styles.actionPrimary,
        tone === "success" && styles.actionSuccess
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
    >
      <Ionicons name={icon} size={18} color={tone === "secondary" ? palette.teal : palette.surface} />
      <Text style={[styles.actionText, tone !== "secondary" && styles.actionTextLight]} allowFontScaling>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function IconButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.iconButton} accessibilityRole="button" accessibilityLabel={label} onPress={onPress}>
      <Ionicons name={icon} size={24} color={palette.ink} />
    </Pressable>
  );
}

function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.filterChip, active && styles.filterChipActive]} onPress={onPress}>
      <Text style={[styles.filterText, active && styles.filterTextActive]} allowFontScaling>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function Pill({ text, tone }: { text: string; tone: "safe" | "info" | "warning" | "danger" | "muted" }) {
  return (
    <View style={[styles.pill, pillStyle(tone)]}>
      <Text style={[styles.pillText, tone === "muted" && styles.pillTextMuted]} allowFontScaling>
        {text}
      </Text>
    </View>
  );
}

function toneColor(tone: "blue" | "green" | "teal" | "red" | "amber") {
  return {
    blue: palette.blue,
    green: palette.green,
    teal: palette.teal,
    red: palette.red,
    amber: palette.amber
  }[tone];
}

function pillStyle(tone: "safe" | "info" | "warning" | "danger" | "muted") {
  return {
    safe: { backgroundColor: "#e4f4e7", borderColor: "#b9dfc0" },
    info: { backgroundColor: "#e7eef7", borderColor: "#bfd0e6" },
    warning: { backgroundColor: "#fff3d8", borderColor: "#e5c270" },
    danger: { backgroundColor: "#fde8e6", borderColor: "#efb2ab" },
    muted: { backgroundColor: "#eef1f0", borderColor: "#d4dbd8" }
  }[tone];
}

function eventIcon(type: EventType): IconName {
  const icons: Record<EventType, IconName> = {
    appointment: "calendar-outline",
    transport: "car-outline",
    visit: "home-outline",
    reminder: "notifications-outline",
    document: "document-text-outline"
  };

  return icons[type];
}

function showMessage(title: string, message: string) {
  Alert.alert(title, message);
}

const styles = StyleSheet.create({
  app: {
    flex: 1,
    backgroundColor: palette.page
  },
  topBar: {
    paddingTop: Platform.OS === "ios" ? 58 : 34,
    paddingHorizontal: 14,
    paddingBottom: 14,
    backgroundColor: palette.surface,
    borderBottomWidth: 1,
    borderBottomColor: palette.line,
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  brandMark: {
    width: 42,
    height: 42,
    borderRadius: 8,
    backgroundColor: palette.teal,
    alignItems: "center",
    justifyContent: "center"
  },
  brandText: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0
  },
  productName: {
    fontSize: 19,
    fontWeight: "800",
    color: palette.ink
  },
  productMeta: {
    fontSize: 13,
    color: palette.muted,
    marginTop: 2
  },
  languageButton: {
    minWidth: 54,
    minHeight: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surface,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingHorizontal: 8
  },
  headerIconButton: {
    minWidth: 44,
    paddingHorizontal: 8
  },
  languageButtonText: {
    fontSize: 12,
    color: palette.teal,
    fontWeight: "800"
  },
  container: {
    flex: 1
  },
  content: {
    padding: 8,
    paddingBottom: 16
  },
  actorRow: {
    gap: 10,
    paddingBottom: 2
  },
  actorChip: {
    minWidth: 150,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surface,
    paddingVertical: 10,
    paddingHorizontal: 12
  },
  actorChipActive: {
    backgroundColor: "#e5f3ef",
    borderColor: palette.teal
  },
  actorChipDisabled: {
    opacity: 0.62
  },
  actorName: {
    fontSize: 15,
    fontWeight: "700",
    color: palette.ink
  },
  actorNameActive: {
    color: palette.teal
  },
  actorRole: {
    fontSize: 12,
    color: palette.muted,
    marginTop: 2
  },
  actorRoleActive: {
    color: palette.teal
  },
  notice: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    padding: 12,
    backgroundColor: "#fffaf0",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ead7ab",
    marginVertical: 10
  },
  noticeText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: palette.ink
  },
  sectionTitle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
    marginBottom: 4
  },
  sectionTitleText: {
    fontSize: 17,
    fontWeight: "800",
    color: palette.ink
  },
  metricGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10
  },
  metric: {
    flexGrow: 1,
    flexBasis: "47%",
    minHeight: 64,
    backgroundColor: palette.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.line,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10
  },
  metricText: {
    flex: 1,
    flexShrink: 1
  },
  metricIcon: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12
  },
  metricValue: {
    fontSize: 24,
    fontWeight: "800",
    color: palette.ink
  },
  metricLabel: {
    fontSize: 13,
    color: palette.muted,
    marginTop: 4
  },
  panel: {
    backgroundColor: palette.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.line,
    padding: 14,
    marginBottom: 10,
    gap: 10
  },
  panelHeader: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    justifyContent: "space-between"
  },
  panelTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: palette.ink
  },
  panelSubtitle: {
    fontSize: 13,
    color: palette.muted,
    marginTop: 2
  },
  bodyText: {
    fontSize: 14,
    lineHeight: 20,
    color: palette.ink
  },
  permissionWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  permissionChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 6,
    backgroundColor: "#f0f5fb",
    paddingVertical: 6,
    paddingHorizontal: 8
  },
  permissionText: {
    fontSize: 12,
    color: palette.blue
  },
  listItem: {
    backgroundColor: palette.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.line,
    padding: 12,
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10
  },
  nextActionItem: {
    minHeight: 68,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: "#f8fbfa",
    padding: 10,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10
  },
  nextActionIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: palette.blue,
    alignItems: "center",
    justifyContent: "center"
  },
  listText: {
    flex: 1,
    minWidth: 150
  },
  notificationCard: {
    backgroundColor: palette.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.line,
    padding: 12,
    marginBottom: 8,
    flexDirection: "row",
    gap: 10
  },
  notificationIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: "#eef7f4",
    alignItems: "center",
    justifyContent: "center"
  },
  notificationHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10
  },
  itemTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: palette.ink
  },
  itemMeta: {
    fontSize: 13,
    color: palette.muted,
    marginTop: 4,
    lineHeight: 18
  },
  taskCard: {
    backgroundColor: palette.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.line,
    padding: 14,
    marginBottom: 12,
    gap: 10
  },
  taskMetaRow: {
    flexDirection: "row",
    gap: 10,
    flexWrap: "wrap",
    alignItems: "center"
  },
  subtaskRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8
  },
  subtaskText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: palette.ink
  },
  warningText: {
    color: palette.red,
    fontSize: 13,
    lineHeight: 18
  },
  proofText: {
    color: palette.green,
    fontSize: 13,
    fontWeight: "700"
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    alignItems: "center",
    marginVertical: 6
  },
  settingsInlineActions: {
    flexDirection: "row",
    flexWrap: "nowrap",
    gap: 8,
    alignItems: "stretch",
    alignSelf: "stretch"
  },
  settingsInlineButton: {
    flex: 1,
    minWidth: 0,
    alignSelf: "stretch",
    justifyContent: "center"
  },
  actionButton: {
    minHeight: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.teal,
    paddingHorizontal: 8,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: palette.surface
  },
  actionPrimary: {
    backgroundColor: palette.teal
  },
  nameSaveButton: {
    justifyContent: "center"
  },
  actionSuccess: {
    backgroundColor: palette.green,
    borderColor: palette.green
  },
  actionText: {
    color: palette.teal,
    fontWeight: "800",
    fontSize: 13
  },
  actionTextLight: {
    color: palette.surface
  },
  safetyToggle: {
    minHeight: 46,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surface,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  safetyToggleActive: {
    borderColor: palette.teal,
    backgroundColor: "#e5f3ef"
  },
  safetyToggleText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: palette.ink,
    fontWeight: "700"
  },
  roleButtonGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  roleButton: {
    minHeight: 38,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surface,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  roleButtonActive: {
    backgroundColor: "#e5f3ef",
    borderColor: palette.teal
  },
  roleButtonDisabled: {
    opacity: 0.48
  },
  roleButtonText: {
    fontSize: 12,
    fontWeight: "800",
    color: palette.ink
  },
  roleButtonTextActive: {
    color: palette.teal
  },
  roleChangeButton: {
    minHeight: 38,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.teal,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "#f8fbfa"
  },
  roleChangeButtonText: {
    flexShrink: 1,
    color: palette.teal,
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 17
  },
  deleteButton: {
    borderColor: palette.red,
    backgroundColor: "#fff5f5"
  },
  roleNameInput: {
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: "#fff",
    marginBottom: 12
  },
  ocrTextBox: { backgroundColor: "#f1f5f9", borderRadius: 6, padding: 8, marginTop: 4 },
  ocrText: { fontSize: 12, color: "#334155", lineHeight: 17 },
  codeBox: {
    alignSelf: "center",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: "#e5f3ef"
  },
  codeText: { fontSize: 30, fontWeight: "800", color: palette.teal, letterSpacing: 6 },
  backBar: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 4
  },
  backButtonText: {
    color: palette.teal,
    fontSize: 14,
    fontWeight: "700"
  },
  templateGrid: {
    gap: 8
  },
  templateButton: {
    minHeight: 64,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: "#f8fbfa",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10
  },
  templateIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.teal
  },
  templateTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: palette.ink
  },
  filterRow: {
    gap: 8,
    paddingBottom: 8
  },
  filterChip: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.line,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: palette.surface
  },
  filterChipActive: {
    backgroundColor: palette.blue,
    borderColor: palette.blue
  },
  filterText: {
    color: palette.ink,
    fontSize: 13,
    fontWeight: "700"
  },
  filterTextActive: {
    color: palette.surface
  },
  timelineItem: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 12
  },
  timelineMarker: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.blue
  },
  timelineBody: {
    flex: 1,
    backgroundColor: palette.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.line,
    padding: 12
  },
  reportStats: {
    flexDirection: "row",
    gap: 10
  },
  reportText: {
    fontSize: 14,
    lineHeight: 21,
    color: palette.ink,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" })
  },
  reportPreview: {
    fontSize: 13,
    lineHeight: 19,
    color: palette.ink,
    backgroundColor: "#f8fbfa",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.line,
    padding: 10
  },
  auditItem: {
    flexDirection: "row",
    gap: 10,
    backgroundColor: palette.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.line,
    padding: 12,
    marginBottom: 8
  },
  compactAuditItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: palette.line,
    paddingTop: 10
  },
  auditIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: "#e2f3ef",
    alignItems: "center",
    justifyContent: "center"
  },
  tabBar: {
    minHeight: 68,
    marginHorizontal: 12,
    marginBottom: Platform.OS === "ios" ? 24 : 14,
    borderRadius: 8,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    paddingHorizontal: 6,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6
  },
  tabButton: {
    flex: 1,
    minHeight: 54,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    borderRadius: 8
  },
  tabButtonActive: {
    backgroundColor: "#e5f3ef"
  },
  tabLabel: {
    fontSize: 10,
    color: palette.gray,
    fontWeight: "700"
  },
  tabLabelActive: {
    color: palette.teal
  },
  pill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 5,
    paddingHorizontal: 8,
    alignSelf: "flex-start"
  },
  pillText: {
    fontSize: 11,
    fontWeight: "800",
    color: palette.ink,
    textTransform: "capitalize"
  },
  pillTextMuted: {
    color: palette.gray
  },
  modalScrim: {
    flex: 1,
    backgroundColor: "rgba(23, 32, 38, 0.38)",
    justifyContent: "flex-end"
  },
  keyboardModal: {
    flex: 1
  },
  modalContent: {
    maxHeight: "74%",
    backgroundColor: palette.surface,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    padding: 18,
    gap: 12
  },
  roleModalContent: {
    maxHeight: "70%",
    backgroundColor: palette.surface,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    padding: 18,
    gap: 12
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  modalReportScroll: {
    maxHeight: 440
  },
  roleChoiceList: {
    gap: 8
  },
  roleChoiceButton: {
    minHeight: 76,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: "#f8fbfa",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 12
  },
  roleChoiceButtonActive: {
    borderColor: palette.teal,
    backgroundColor: "#e5f3ef"
  },
  roleChoiceIcon: {
    paddingTop: 2
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: palette.ink
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#eef1f0"
  },
  preferenceActions: {
    alignItems: "flex-end",
    gap: 8
  },
  smallIconButton: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surface,
    alignItems: "center",
    justifyContent: "center"
  },
  weeklyHistory: { marginTop: 12, borderTopWidth: 1, borderTopColor: "#e2e8f0", paddingTop: 8 },
  weeklyHistoryTitle: { fontWeight: "700", fontSize: 13, color: "#334155", marginBottom: 4 },
  weeklyHistoryRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  weeklyHistoryDate: { fontSize: 12, color: "#64748b" },
  weeklyHistoryMetrics: { fontSize: 12, color: "#334155" },
  lockedExportBtn: { padding: 6, borderRadius: 6, opacity: 0.6 }
});
