import { useEffect, useState } from "react";
import { MongoAbility, MongoQuery } from "@casl/ability";
import { Edge, Node, useEdgesState, useNodesState } from "@xyflow/react";

import { ProjectPermissionSub, useWorkspace } from "@app/context";
import { ProjectPermissionSet } from "@app/context/ProjectPermissionContext";
import { useListProjectEnvironmentsFolders } from "@app/hooks/api/secretFolders/queries";
import { TSecretFolderWithPath } from "@app/hooks/api/secretFolders/types";

import { useAccessTreeContext } from "../components";
import { PermissionAccess } from "../types";
import {
  createBaseEdge,
  createFolderNode,
  createRoleNode,
  getSubjectActionRuleMap,
  positionElements
} from "../utils";
import { createShowMoreNode } from "../utils/createShowMoreNode";

const INITIAL_FOLDERS_PER_LEVEL = 10;
const FOLDERS_INCREMENT = 10;

type LevelFolderMap = Record<
  string,
  {
    folders: TSecretFolderWithPath[];
    visibleCount: number;
    hasMore: boolean;
  }
>;

export const useAccessTree = (
  permissions: MongoAbility<ProjectPermissionSet, MongoQuery>,
  searchPath: string
) => {
  const { currentWorkspace } = useWorkspace();
  const { secretName, setSecretName, setViewMode, viewMode } = useAccessTreeContext();
  const [nodes, setNodes] = useNodesState<Node>([]);
  const [edges, setEdges] = useEdgesState<Edge>([]);
  const [subject, setSubject] = useState(ProjectPermissionSub.Secrets);
  const [environment, setEnvironment] = useState(currentWorkspace.environments[0]?.slug ?? "");
  const { data: environmentsFolders, isPending } = useListProjectEnvironmentsFolders(
    currentWorkspace.id
  );

  const [levelFolderMap, setLevelFolderMap] = useState<LevelFolderMap>({});
  const [totalFolderCount, setTotalFolderCount] = useState(0);

  const showMoreFolders = (parentId: string) => {
    setLevelFolderMap((prevMap) => {
      const level = prevMap[parentId];
      if (!level) return prevMap;

      const newVisibleCount = Math.min(
        level.visibleCount + FOLDERS_INCREMENT,
        level.folders.length
      );

      return {
        ...prevMap,
        [parentId]: {
          ...level,
          visibleCount: newVisibleCount,
          hasMore: newVisibleCount < level.folders.length
        }
      };
    });
  };

  const levelsWithMoreFolders = Object.entries(levelFolderMap)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    .filter(([_, level]) => level.hasMore)
    .map(([parentId]) => parentId);

  const getLevelCounts = (parentId: string) => {
    const level = levelFolderMap[parentId];
    if (!level) return { visibleCount: 0, totalCount: 0, hasMore: false };

    return {
      visibleCount: level.visibleCount,
      totalCount: level.folders.length,
      hasMore: level.hasMore
    };
  };

  useEffect(() => {
    if (!environmentsFolders || !permissions || !environmentsFolders[environment]) return;

    const { folders } = environmentsFolders[environment];

    setTotalFolderCount(folders.length);

    const groupedFolders: Record<string, TSecretFolderWithPath[]> = {};

    const filteredFolders = folders.filter((folder) => {
      if (folder.path.startsWith(searchPath)) {
        return true;
      }

      if (
        searchPath.startsWith(folder.path) &&
        (folder.path === "/" ||
          searchPath === folder.path ||
          searchPath.indexOf("/", folder.path.length) === folder.path.length)
      ) {
        return true;
      }

      return false;
    });

    filteredFolders.forEach((folder) => {
      const parentId = folder.parentId || "";
      if (!groupedFolders[parentId]) {
        groupedFolders[parentId] = [];
      }
      groupedFolders[parentId].push(folder);
    });

    const newLevelFolderMap: LevelFolderMap = {};

    Object.entries(groupedFolders).forEach(([parentId, folderList]) => {
      const key = parentId;
      newLevelFolderMap[key] = {
        folders: folderList,
        visibleCount: Math.min(INITIAL_FOLDERS_PER_LEVEL, folderList.length),
        hasMore: folderList.length > INITIAL_FOLDERS_PER_LEVEL
      };
    });

    setLevelFolderMap(newLevelFolderMap);
  }, [permissions, environmentsFolders, environment, subject, secretName, searchPath]);

  useEffect(() => {
    if (
      !environmentsFolders ||
      !permissions ||
      !environmentsFolders[environment] ||
      Object.keys(levelFolderMap).length === 0
    )
      return;

    const { name } = environmentsFolders[environment];

    const roleNode = createRoleNode({
      subject,
      environment: name
    });

    const actionRuleMap = getSubjectActionRuleMap(subject, permissions);

    const visibleFolders: TSecretFolderWithPath[] = [];

    Object.values(levelFolderMap).forEach((levelData) => {
      visibleFolders.push(...levelData.folders.slice(0, levelData.visibleCount));
    });

    const folderNodes = visibleFolders.map((folder) =>
      createFolderNode({
        folder,
        permissions,
        environment,
        subject,
        secretName,
        actionRuleMap
      })
    );

    const folderEdges = folderNodes.map(({ data: folder }) => {
      const actions = Object.values(folder.actions);

      let access: PermissionAccess;
      if (Object.values(actions).some((action) => action === PermissionAccess.Full)) {
        access = PermissionAccess.Full;
      } else if (Object.values(actions).some((action) => action === PermissionAccess.Partial)) {
        access = PermissionAccess.Partial;
      } else {
        access = PermissionAccess.None;
      }

      return createBaseEdge({
        source: folder.parentId ?? roleNode.id,
        target: folder.id,
        access
      });
    });

    const addMoreButtons: Node[] = [];

    Object.entries(levelFolderMap).forEach(([parentId, levelData]) => {
      const key = parentId === "null" ? null : parentId;

      if (key && levelData.hasMore) {
        const showMoreButtonNode = createShowMoreNode({
          parentId: key,
          onClick: () => showMoreFolders(key),
          remaining: levelData.folders.length - levelData.visibleCount
        });

        addMoreButtons.push(showMoreButtonNode);

        folderEdges.push(
          createBaseEdge({
            source: key,
            target: showMoreButtonNode.id,
            access: PermissionAccess.Full,
            hideEdge: true
          })
        );
      }
    });

    const init = positionElements([roleNode, ...folderNodes, ...addMoreButtons], [...folderEdges]);
    setNodes(init.nodes);
    setEdges(init.edges);
  }, [
    levelFolderMap,
    permissions,
    environmentsFolders,
    environment,
    subject,
    secretName,
    setNodes,
    setEdges
  ]);

  return {
    nodes,
    edges,
    subject,
    environment,
    setEnvironment,
    setSubject,
    isLoading: isPending,
    environments: currentWorkspace.environments,
    secretName,
    setSecretName,
    viewMode,
    setViewMode,
    levelFolderMap,
    showMoreFolders,
    levelsWithMoreFolders,
    getLevelCounts,
    totalFolderCount
  };
};
