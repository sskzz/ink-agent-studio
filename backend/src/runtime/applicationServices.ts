import { ConfigRepository } from "../config/configRepository.js";
import { ConfigService } from "../config/configService.js";
import { LegacyRunImporter } from "../modules/agents/legacyRunImporter.js";
import { RunCoordinator } from "../modules/agents/runCoordinator.js";
import { createRunCommandHandlers } from "../modules/agents/runCommandHandlers.js";
import { RunEventHub } from "../modules/agents/runEventHub.js";
import { RunEventStore } from "../modules/agents/runEventStore.js";
import { PatchRepository } from "../modules/patches/patchRepository.js";
import { PatchService } from "../modules/patches/patchService.js";
import { createNovelToolRegistry } from "../modules/tools/novelToolRegistry.js";
import { SessionRepository } from "../modules/sessions/sessionRepository.js";
import { SessionService } from "../modules/sessions/sessionService.js";
import { SkillRepository } from "../modules/skills/skillRepository.js";
import { SkillService } from "../modules/skills/skillService.js";
import { PreferenceRepository } from "../modules/memory/preferenceRepository.js";
import { PreferenceService } from "../modules/memory/preferenceService.js";
import { createWorkspacePaths, type WorkspacePaths } from "../modules/workspace/workspacePaths.js";
import { RuntimeDatabase } from "./database/runtimeDatabase.js";
import { WorkspaceLease } from "./workspaceLease.js";

/**
 * 应用服务装配。
 * 把仓储、协调器、技能/会话/偏好等服务按依赖关系组合成单一对象，
 * 路由层只依赖 ApplicationServices，不关心具体实例如何创建。
 */

/**
 * 全后端共享的服务集合：路由处理器与启动逻辑统一从它取依赖。
 */
export interface ApplicationServices {
  paths: WorkspacePaths;
  configService: ConfigService;
  runtimeDatabase: RuntimeDatabase;
  runEventHub: RunEventHub;
  runEventStore: RunEventStore;
  runCoordinator: RunCoordinator;
  legacyRunImporter: LegacyRunImporter;
  patchService: PatchService;
  toolRegistry: ReturnType<typeof createNovelToolRegistry>;
  sessionService: SessionService;
  skillService: SkillService;
  preferenceService: PreferenceService;
  workspaceLease: WorkspaceLease;
}

/**
 * 组装默认应用服务。
 * 数据库、配置、事件存储等依赖顺序固定；测试可通过传入自定义 paths 获得隔离实例。
 */
export function createApplicationServices(paths = createWorkspacePaths()): ApplicationServices {
  const runtimeDatabase = new RuntimeDatabase(paths);
  const runEventHub = new RunEventHub();
  const configService = new ConfigService(new ConfigRepository(paths));
  const runEventStore = new RunEventStore(runtimeDatabase, runEventHub);
  const patchService = new PatchService(paths, new PatchRepository(runtimeDatabase), runEventStore, configService);
  return {
    paths,
    configService,
    runtimeDatabase,
    runEventHub,
    runEventStore,
    runCoordinator: new RunCoordinator(configService, runEventStore, createRunCommandHandlers(paths)),
    legacyRunImporter: new LegacyRunImporter(runtimeDatabase, paths),
    patchService,
    toolRegistry: createNovelToolRegistry(),
    sessionService: new SessionService(new SessionRepository(runtimeDatabase), configService),
    skillService: new SkillService(new SkillRepository(paths)),
    preferenceService: new PreferenceService(new PreferenceRepository(runtimeDatabase), configService),
    workspaceLease: new WorkspaceLease(paths)
  };
}
