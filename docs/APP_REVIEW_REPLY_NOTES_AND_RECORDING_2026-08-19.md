# TaskKin Care - 4000 字符审核回复、Review Notes 与录屏步骤

准备日期：2026-08-19  
App：TaskKin Care  
Bundle ID：`cd.cc.relaycare`  
当前本地版本：`1.0.0 (2)`

Apple 官方说明：

- [`Reply to App Review`](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/reply-to-app-review-messages/) 最多 4000 characters，并可通过 `Attach File` 添加录屏或支持文件。
- [`App Review Information > Notes`](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information) 最多 4000 bytes，应填写审核所需的设置、测试账号和操作信息。

## 提交前必须替换的占位符

以下内容不得带着方括号提交：

- `[BUILD]`
- `[VIDEO_FILENAME]`
- `[TEST_DATE]`
- `[DEVICE_MODEL]`
- `[IOS_VERSION]`
- `[SECOND_DEVICE_AND_IOS_OR_DELETE_THIS_LINE]`
- `[COORDINATOR_EMAIL]` / `[COORDINATOR_PASSWORD]`
- `[DELETION_EMAIL]` / `[DELETION_PASSWORD]`
- 可选的 Caregiver / Viewer 账号占位符

不要把 App Store Connect 密码、Apple ID、API key、service-role key 或真实家庭/健康资料写入这两个字段或附件。

---

## 位置一：Reply to App Review

用途：直接回应 Apple 本次消息提出的 8 项问题。录屏应在此处使用 `Attach File` 上传。

复制下面代码块内的英文内容；替换全部占位符后再发送：

```text
Dear App Review Team,

Thank you. The requested information is below and is also included in App Review Information > Notes.

1. SCREEN RECORDING
Attached: [VIDEO_FILENAME], recorded [TEST_DATE] on a physical [DEVICE_MODEL], iOS [IOS_VERSION]. It begins by launching TaskKin Care and shows consent, registration/login, household setup, core tabs, document upload and on-device OCR confirmation, camera/notification prompts, reports/export, member controls, IAP/restore/manage, and account deletion.

Content is private to invited households. There is no public feed, discovery, messaging, comments, profiles, or stranger interaction, so public report/block flows are not applicable. Coordinators can remove members; members can leave.

2. TESTED DEVICES
- [DEVICE_MODEL], iOS [IOS_VERSION], physical device, TestFlight build [BUILD], tested [TEST_DATE]
- [SECOND_DEVICE_AND_IOS_OR_DELETE_THIS_LINE]

3. FUNCTIONS AND AUDIENCE
TaskKin Care is a non-clinical coordination app for adult family members and trusted caregivers. It organizes tasks/handoffs, timeline updates, private documents, notifications, reports, and audit. It does not diagnose, treat, prescribe, provide emergency triage, handle insurance/billing, or integrate with medical records.

4. ACCESS AND SETUP
Coordinator: [COORDINATOR_EMAIL] / [COORDINATOR_PASSWORD]
Deletion-only account: [DELETION_EMAIL] / [DELETION_PASSWORD]
Optional Caregiver: [CAREGIVER_EMAIL] / [CAREGIVER_PASSWORD]
Optional Viewer: [VIEWER_EMAIL] / [VIEWER_PASSWORD]

Do not delete the Coordinator account. Home shows metrics/notifications. Tasks supports create/claim/reject/handoff/complete/delete. Timeline adds/filters updates. Docs > Upload document uses attached taskkin-care-review-sample-schedule.pdf, performs on-device OCR, then requires Confirm and create task. Settings contains household/member controls, reports/export, audit, Plan, legal links, and deletion. Delete only the deletion account.

5. EXTERNAL SERVICES
Supabase: Auth, PostgreSQL, Realtime, private Storage, Edge Functions. Apple: StoreKit 2/Server Notifications, Vision on-device OCR, notifications, QR camera, file picker, share/PDF services. GitHub Pages hosts support/legal pages; Expo/React Native is the framework. No external LLM/cloud OCR, ads, analytics, tracking, or social login.

6. REGIONS
Core features are the same in all regions. English, Simplified Chinese, and Spanish are available everywhere; only App Store price/currency varies. Nothing is region-locked.

7. REGULATED/PROTECTED MATERIAL
Not applicable. The app is not a medical device, healthcare/telehealth/emergency service, insurer, or clinical tool, and bundles no protected third-party material. Uploads must be authorized private, non-PHI files.

8. IN-APP PURCHASE
Family Plus is an optional auto-renewable household subscription for Coordinators: monthly TaskKin.care.pro.mon and yearly TaskKin.care.pro.yearly. It unlocks 3 households/12 members, unlimited active tasks, 50 OCR uploads/month, PDF/CSV export, advanced notifications, report history, and 3-year audit retention.

Path: Coordinator > Settings > Plan > Upgrade to Family Plus > monthly/yearly. The paywall shows localized price/duration, renewal terms, Restore Purchase, Terms, and Privacy. Manage Plan opens Apple's subscription settings. Account deletion does not cancel the subscription.

Support: Billy.yu@me.com
Privacy: https://junyu17.github.io/relaycare/privacy.html
Terms: https://junyu17.github.io/relaycare/terms.html

Thank you for reviewing TaskKin Care.
```

当前模板实测：**3527 characters / 3527 bytes**。替换占位符后必须重新计算，并保持在 3900 characters 以下。

---

## 位置二：App Review Information > Notes

用途：以后每次提交都保留的审核操作说明。App Store Connect 的独立 `Username` 和 `Password` 字段也应填写永久 Coordinator 账号；Notes 内再次列出是为了让操作路径完整。

复制下面代码块内的英文内容：

```text

TASKKIN CARE REVIEW NOTES - VERSION 1.0.0, BUILD 3

VIDEO/DEVICE
Attachment: TaskKin.mp4
Recorded [TEST_DATE] on physical [DEVICE_MODEL], iOS [IOS_VERSION]. The video begins with app launch and covers registration/login, core features, permissions, IAP, restore/manage, and account deletion.

REVIEW ACCOUNTS
Coordinator: [COORDINATOR_EMAIL] / [COORDINATOR_PASSWORD]
Deletion-only: [DELETION_EMAIL] / [DELETION_PASSWORD]
Optional Caregiver: [CAREGIVER_EMAIL] / [CAREGIVER_PASSWORD]
Optional Viewer: [VIEWER_EMAIL] / [VIEWER_PASSWORD]
Do not delete the permanent Coordinator account. Use only the deletion-only account for Settings > Delete account & households.

MAIN REVIEW PATHS
- Home: household metrics, next actions, notifications, and role capabilities.
- Tasks: create a template/custom task, then claim, reject, hand off, complete, or delete.
- Timeline: add and filter private coordination updates.
- Docs: acknowledge non-PHI notice > Upload document > choose attached taskkin-care-review-sample-schedule.pdf > review on-device OCR > Confirm and create task.
- Settings: household switching, invite code/QR, member/role controls, weekly report, PDF/CSV export, Coordinator audit trail, Plan, legal links, and account deletion.

IAP
Only a Coordinator can purchase/restore Family Plus for the household.
Path: Settings > Plan > Upgrade to Family Plus > monthly or yearly.
Products: TaskKin.care.pro.mon (1 month) and TaskKin.care.pro.yearly (1 year), with StoreKit-localized prices.
Plus unlocks 3 households/12 members, unlimited active tasks, 50 OCR uploads/month, PDF/CSV export, advanced notifications, report history, and 3-year audit retention. The paywall shows price/duration, renewal disclosure, Restore, Terms, and Privacy. Manage Plan opens Apple's subscription settings. Account deletion does not cancel it.

CONTENT AND PERMISSIONS
Content is private to invited households. There is no public feed, discovery, messaging, comments, profiles, or stranger interaction, so public report/block flows are not applicable. Coordinators can remove members; members can leave.
Notifications are for coordination alerts. Camera appears only after QR scan; manual 6-digit entry is available. Documents use the file picker. No location, contacts, microphone, ATT, ads, or tracking.

PURPOSE/SERVICES/REGIONS
TaskKin Care is a non-clinical organization tool for adult family members/trusted caregivers. It provides tasks/handoffs, timeline, private documents, notifications, reports, and audit; no diagnosis, treatment, emergency triage, insurance/billing, or medical-record integration.
Services: Supabase Auth/database/Realtime/private Storage/Edge Functions; Apple StoreKit 2/Server Notifications, Vision on-device OCR, and iOS notification/camera/file/share/PDF services; GitHub Pages; Expo/React Native. No external LLM/cloud OCR, ads, analytics, tracking, or social login.
Core functionality is the same in all regions. EN, Simplified Chinese, and Spanish are available everywhere; only storefront price/currency varies.
No regulated-industry credential is required: the app is not a medical device or healthcare/telehealth/emergency service and bundles no protected third-party material. Uploads must be authorized private, non-PHI files.

Support: Billy.yu@me.com
Privacy: https://junyu17.github.io/relaycare/privacy.html
Terms: https://junyu17.github.io/relaycare/terms.html
```

1. SCREEN RECORDING
   Attached: TaskKin.mp4 recorded Aug 20 on a physical iPhone Air, iOS 26.6.1. It begins by launching TaskKin Care and shows consent, registration/login, household setup, core tabs, document upload and on-device OCR confirmation, notification prompts, reports/export, member controls, IAP/restore/manage, and account deletion.

Content is private to invited households. There is no public feed, discovery, messaging, comments, profiles, or stranger interaction, so public report/block flows are not applicable. Coordinators can remove members; members can also leave the household.

2. TESTED DEVICES
   iPhone Air, iOS 26.6.1 and iPhone 12 iOS 26.6 physical devices, TestFlight build 3, tested Aug 20.

3. FUNCTIONS AND AUDIENCE
   TaskKin Care is a non-clinical coordination app for adult family members and trusted caregivers. It organizes tasks/handoffs, timeline updates, private documents, notifications, reports, and audit. It does not diagnose, treat, prescribe, provide emergency triage, handle insurance/billing, or integrate with medical records.

4. ACCESS AND SETUP
   Only coordinator needs login, others can join only by family code: scan or input generated by coordinator in "settings" page
   Coordinator: [COORDINATOR_EMAIL] / [COORDINATOR_PASSWORD]

Home shows metrics/notifications. Tasks supports create/claim/reject/handoff/complete/delete. Timeline adds/filters updates. Docs > Upload document uses attached taskkin-care-review-sample-schedule.pdf, performs on-device OCR, then requires Confirm and create task. Settings contains household/member controls, reports/export, audit, Plan, legal links, and deletion.

5. EXTERNAL SERVICES
   Supabase: Auth, PostgreSQL, Realtime, private Storage, Edge Functions. Apple: StoreKit 2/Server Notifications, Vision on-device OCR, notifications, QR camera, file picker, share/PDF services. GitHub Pages hosts support/legal pages; Expo/React Native is the framework. No external LLM/cloud OCR, ads, analytics, tracking, or social login.

6. REGIONS
   Core features are the same in all regions. English, Simplified Chinese, and Spanish are available everywhere; only App Store price/currency varies. Nothing is region-locked.

7. REGULATED/PROTECTED MATERIAL
   Not applicable. The app is not a medical device, healthcare/telehealth/emergency service, insurer, or clinical tool, and bundles no protected third-party material. Uploads must be authorized private, non-PHI files.

8. IN-APP PURCHASE
   Family Plus is an optional auto-renewable household subscription for Coordinators: monthly TaskKin.care.pro.mon and yearly TaskKin.care.pro.yearly. It unlocks 3 households/12 members, unlimited active tasks, 50 OCR uploads/month, PDF/CSV export, advanced notifications, report history, and 3-year audit retention.

Path: Coordinator > Settings > Plan > Upgrade to Family Plus > monthly/yearly. The paywall shows localized price/duration, renewal terms, Restore Purchase, Terms, and Privacy. Manage Plan opens Apple's subscription settings. Account deletion does not cancel the subscription.

Support: Billy.yu@me.com
Privacy: https://junyu17.github.io/relaycare/privacy.html
Terms: https://junyu17.github.io/relaycare/terms.html

Thank you for reviewing TaskKin Care.

当前模板实测：**3402 characters / 3402 bytes**。Notes 按 bytes 计算；上述文本使用英文 ASCII，替换后保持在 3900 bytes 以下。

---

## 实体设备录屏步骤

建议录制 1 个连续的 8-12 分钟视频。如果超过限制或内容难以连续准备，可以拆为：

1. `TaskKinCare-core-flow-build-[BUILD].mov`
2. `TaskKinCare-IAP-delete-build-[BUILD].mov`

在 Reply 和 Notes 中列出所有实际附件名。

### A. 录屏前准备

1. 在实体 iPhone 上安装最终要提交的同一个 TestFlight build；不要使用开发版或模拟器。
2. 更新到当时最新公开 iOS，并在 `Settings > General > About` 记录准确设备型号和 iOS 版本。不要把设备昵称当作型号。
3. 准备三类账号：永久 Coordinator 审核账号；保留给 Apple 的稳定 deletion-only 账号；录屏中创建并删除的一次性账号。可选准备同一家庭的 Caregiver 和 Viewer 账号。不要在录屏中删除前两类账号。
4. 将 [样例 PDF](../output/pdf/taskkin-care-review-sample-schedule.pdf) 保存到 iPhone 的 Files app。
5. 确认月订阅和年订阅均能显示真实 StoreKit 本地化价格；准备 Sandbox 测试账号。不要录制 fallback price 或产品不可用状态。
6. 删除并重新安装 TestFlight build，或重置相机/通知权限，确保权限弹窗能自然出现。
7. 开启 Focus / Do Not Disturb，关闭私人通知预览；清除最近照片和文件中的真实个人资料。
8. 录屏前退出所有账号，停在 iPhone Home Screen。视频第一项动作必须是点击 TaskKin Care 启动。

### B. 推荐镜头顺序

| 时间 | 操作                                                                               | 必须展示的证据                                            |
| ---- | ---------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 0:00 | 从 Home Screen 点击 TaskKin Care                                                   | 视频以启动 App 开始                                       |
| 0:05 | 首次同意页，短暂打开 Privacy/Terms，接受                                           | 法律披露、语言入口                                        |
| 0:35 | 用新的录屏一次性邮箱走 Create account；创建临时家庭并记住登录信息                  | 注册和 Coordinator onboarding                             |
| 1:15 | Sign out，再登录永久 Coordinator 账号                                              | 登录和准备好的虚构样例数据                                |
| 1:40 | Home                                                                               | 指标、next actions、通知和角色能力                        |
| 2:10 | Tasks：创建、claim/reject、handoff、complete、delete                               | 核心任务生命周期                                          |
| 3:10 | Timeline：新增事件并过滤                                                           | 私有协调记录                                              |
| 3:45 | Docs：确认 non-PHI，选择样例 PDF，查看 OCR，手动确认创建任务                       | 文件选择、Apple Vision OCR、人工确认                      |
| 4:50 | 打开 QR scanner，允许 Camera；返回并展示 6 位码手动输入                            | 相机权限及替代路径                                        |
| 5:25 | 触发 Notification 权限，并展示通知设置                                             | 通知权限用途                                              |
| 5:55 | Settings：invite、roles、remove member/leave、audit、weekly report、PDF/CSV export | 私有内容管理和主要设置                                    |
| 7:00 | Settings > Plan > Upgrade                                                          | 月/年周期、真实本地价格、续订披露、Terms/Privacy、Restore |
| 7:45 | 完成一次 Sandbox purchase 或 Restore，展示 Plus active，再打开 Manage Plan         | 付费访问和管理路径                                        |
| 8:40 | Sign out；重新登录录屏一次性账号；Settings > Delete account & households；确认     | App 内账号删除完整流程                                    |
| 9:30 | 删除完成并回到登录页                                                               | 账号与 session 已删除                                     |

### C. 录屏后检查

- 从头播放，确认第一段确实是启动 App。
- 确认没有真实姓名、邮箱通知、Apple ID、付款信息、API key 或真实文档内容。
- 确认视频能看清点击位置、价格、订阅周期、权限弹窗和删除确认文字。
- 文件名包含 build number；不要使用 `final.mov`、`IMG_1234.mov` 等含糊名称。
- 将录屏通过 `Reply to App Review > Attach File` 上传；同时附加 `taskkin-care-review-sample-schedule.pdf`。
- 上传完成后再发送 Reply，并在 App Review Notes 中写入准确附件名。

## 最终提交检查

- [ ] 两段粘贴文本均无 `[` 或 `]` 占位符。
- [ ] Reply 小于 4000 characters；Notes 小于 4000 bytes。
- [ ] App Review Information 的 Username/Password 与 Notes 一致，且账号不会过期。
- [ ] 实体设备、iOS、TestFlight build、测试日期全部真实。
- [ ] 录屏与提交的是同一 build。
- [ ] 月/年订阅已附加到本次 submission，并能在 TestFlight Sandbox 购买和恢复。
- [ ] 永久 Coordinator 账号未被录屏中的删除操作删除。
- [ ] Notes 中的 deletion-only 账号仍然有效；它不是录屏末尾已删除的一次性账号。
- [ ] 录屏和样例 PDF 已实际上传，而不只是写了文件名。
