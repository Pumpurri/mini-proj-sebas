import React from "react";
import type { ModalProps } from "@mantine/core";
import { Modal, Stack, Text, ScrollArea, Flex, CloseButton, TextInput, Button, Group } from "@mantine/core";
import { CodeHighlight } from "@mantine/code-highlight";
import type { NodeData } from "../../../types/graph";
import useGraph from "../../editor/views/GraphView/stores/useGraph";
import useJson from "../../../store/useJson";
import useFile from "../../../store/useFile";
import toast from "react-hot-toast";

// return object from json removing array and object fields
const normalizeNodeData = (nodeRows: NodeData["text"]) => {
  if (!nodeRows || nodeRows.length === 0) return "{}";
  if (nodeRows.length === 1 && !nodeRows[0].key) return `${nodeRows[0].value}`;

  const obj = {};
  nodeRows?.forEach(row => {
    if (row.type !== "array" && row.type !== "object") {
      if (row.key) obj[row.key] = row.value;
    }
  });
  return JSON.stringify(obj, null, 2);
};

// return json path in the format $["customer"]
const jsonPathToString = (path?: NodeData["path"]) => {
  if (!path || path.length === 0) return "$";
  const segments = path.map(seg => (typeof seg === "number" ? seg : `"${seg}"`));
  return `$[${segments.join("][")}]`;
};

// Update JSON at a specific path
const updateJsonAtPath = (jsonString: string, path: NodeData["path"], newValue: string) => {
  try {
    const parsedJson = JSON.parse(jsonString);
    const parsedNewValue = JSON.parse(newValue);

    if (!path || path.length === 0) {
      // Root level update
      return JSON.stringify(parsedNewValue, null, 2);
    }

    // Navigate to the parent of the target
    let current = parsedJson;
    for (let i = 0; i < path.length - 1; i++) {
      current = current[path[i]];
    }

    // Update the target
    const lastKey = path[path.length - 1];
    current[lastKey] = parsedNewValue;

    return JSON.stringify(parsedJson, null, 2);
  } catch (error) {
    throw new Error("Invalid JSON format");
  }
};

export const NodeModal = ({ opened, onClose }: ModalProps) => {
  const nodeData = useGraph(state => state.selectedNode);
  const [isEditing, setIsEditing] = React.useState(false);
  const [editedValues, setEditedValues] = React.useState<Record<string, string>>({});
  const [optimisticContent, setOptimisticContent] = React.useState<string | null>(null);
  const json = useJson(state => state.json);

  // Get fresh content from JSON store using the path, not from nodeData
  const getFreshContent = () => {
    // Return optimistic content immediately if available (0ms delay)
    if (optimisticContent) return optimisticContent;

    try {
      const parsedJson = JSON.parse(json);
      if (!nodeData?.path || nodeData.path.length === 0) {
        return JSON.stringify(parsedJson, null, 2);
      }

      let current = parsedJson;
      for (const segment of nodeData.path) {
        current = current[segment];
      }

      // Filter out nested objects/arrays like normalizeNodeData does
      if (typeof current === "object" && current !== null && !Array.isArray(current)) {
        const filtered: Record<string, any> = {};
        Object.entries(current).forEach(([key, value]) => {
          if (typeof value !== "object" || value === null) {
            filtered[key] = value;
          }
        });
        return JSON.stringify(filtered, null, 2);
      }

      return JSON.stringify(current, null, 2);
    } catch (e) {
      return normalizeNodeData(nodeData?.text ?? []);
    }
  };

  const originalContent = getFreshContent();

  // Get the full original JSON object at the node's path
  const getFullNodeObject = (): Record<string, any> => {
    try {
      const parsedJson = JSON.parse(json);
      if (!nodeData?.path || nodeData.path.length === 0) {
        return parsedJson;
      }

      let current = parsedJson;
      for (const segment of nodeData.path) {
        current = current[segment];
      }
      return current;
    } catch (e) {
      return {};
    }
  };

  // Parse the JSON content into key-value pairs (only primitive values for editing)
  const parseContentToKeyValues = (content: string): Record<string, string> => {
    try {
      const parsed = JSON.parse(content);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        const result: Record<string, string> = {};
        Object.entries(parsed).forEach(([key, value]) => {
          // Only include primitive values for editing
          if (typeof value !== "object" || value === null) {
            result[key] = typeof value === "string" ? value : JSON.stringify(value);
          }
        });
        return result;
      }
    } catch (e) {
      // If parsing fails, return empty object
    }
    return {};
  };

  React.useEffect(() => {
    if (opened && !isEditing) {
      setEditedValues(parseContentToKeyValues(originalContent));
    }
  }, [opened, originalContent, isEditing]);

  // Clear optimistic content only when modal opens (not when data updates)
  React.useEffect(() => {
    if (opened) {
      setOptimisticContent(null);
    }
  }, [opened]);

  const handleEdit = () => {
    setIsEditing(true);
    setEditedValues(parseContentToKeyValues(originalContent));
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditedValues(parseContentToKeyValues(originalContent));
  };

  const handleValueChange = (key: string, value: string) => {
    setEditedValues(prev => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleSave = () => {
    try {
      // Get the full original object at this node
      const fullNodeObject = getFullNodeObject();

      // Merge edited primitive values into the full object
      const mergedObj = { ...fullNodeObject };
      Object.entries(editedValues).forEach(([key, value]) => {
        // Try to parse the value as JSON, otherwise keep as string
        try {
          mergedObj[key] = JSON.parse(value);
        } catch {
          mergedObj[key] = value;
        }
      });

      const mergedJson = JSON.stringify(mergedObj, null, 2);

      // Optimistic update: show the result immediately (0ms delay)
      const filtered: Record<string, any> = {};
      Object.entries(mergedObj).forEach(([key, value]) => {
        if (typeof value !== "object" || value === null) {
          filtered[key] = value;
        }
      });
      setOptimisticContent(JSON.stringify(filtered, null, 2));

      const updatedJson = updateJsonAtPath(json, nodeData?.path, mergedJson);

      // Update both stores - useFile for the editor and useJson for the graph
      useFile.getState().setContents({ contents: updatedJson, hasChanges: true });

      setIsEditing(false);
      toast.success("JSON updated successfully");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update JSON");
    }
  };

  const handleClose = () => {
    setIsEditing(false);
    setOptimisticContent(null);
    onClose();
  };

  const keyValuePairs = parseContentToKeyValues(originalContent);
  const hasKeyValuePairs = Object.keys(keyValuePairs).length > 0;

  return (
    <Modal size="auto" opened={opened} onClose={handleClose} centered withCloseButton={false}>
      <Stack pb="sm" gap="sm">
        <Stack gap="xs">
          <Flex justify="space-between" align="center">
            <Text fz="xs" fw={500}>
              Content
            </Text>
            <Group gap="xs">
              {isEditing ? (
                <>
                  <Button size="xs" color="green" onClick={handleSave} styles={{ root: { color: 'white' } }}>
                    Save
                  </Button>
                  <Button size="xs" color="red" onClick={handleCancel} styles={{ root: { color: 'white' } }}>
                    Cancel
                  </Button>
                </>
              ) : (
                hasKeyValuePairs && (
                  <Button size="xs" color="blue" onClick={handleEdit}>
                    Edit
                  </Button>
                )
              )}
              <CloseButton onClick={handleClose} />
            </Group>
          </Flex>
          <ScrollArea.Autosize mah={400} maw={600}>
            {isEditing ? (
              <Stack gap="md" miw={350} maw={600}>
                {Object.entries(editedValues).map(([key, value]) => (
                  <Stack key={key} gap={4}>
                    <Text fz="sm" fw={500} c="dimmed">
                      {key}
                    </Text>
                    <TextInput
                      value={value}
                      onChange={(e) => handleValueChange(key, e.target.value)}
                      styles={{
                        input: {
                          fontFamily: "monospace",
                        },
                      }}
                    />
                  </Stack>
                ))}
              </Stack>
            ) : (
              <CodeHighlight
                code={originalContent}
                miw={350}
                maw={600}
                language="json"
                withCopyButton
              />
            )}
          </ScrollArea.Autosize>
        </Stack>
        <Text fz="xs" fw={500}>
          JSON Path
        </Text>
        <ScrollArea.Autosize maw={600}>
          <CodeHighlight
            code={jsonPathToString(nodeData?.path)}
            miw={350}
            mah={250}
            language="json"
            copyLabel="Copy to clipboard"
            copiedLabel="Copied to clipboard"
            withCopyButton
          />
        </ScrollArea.Autosize>
      </Stack>
    </Modal>
  );
};
