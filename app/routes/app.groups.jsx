import prisma from './../db.server';
import { json } from '@remix-run/node';
import { useLoaderData, useFetcher } from '@remix-run/react';
import { useState, useEffect } from 'react';
import { Page, Card, TextField, Button, ResourceList, ResourceItem, Text, Tabs, Modal, Checkbox, Layout } from '@shopify/polaris';
import SelectFreeGift from './app.select-free-gifts';

export async function loader() {
  const groups = await prisma.metafieldGroup.findMany();
  return json(groups);
}

export async function action({ request }) {
  const formData = await request.formData();
  const name = formData.get('name');
  const deleteId = formData.get('deleteId');
  const groupId = formData.get('groupId');
  const selectedMetafields = formData.get('metafields');

  // Handle group deletion
  if (deleteId) {
    await prisma.metafieldGroup.delete({
      where: { id: deleteId },
    });
    return json({ success: true, deletedId: deleteId });
  }

  // Handle new group creation
  if (name) {
    const newGroup = await prisma.metafieldGroup.create({
      data: { name, metafields: JSON.stringify([]) },
    });
    return json(newGroup);
  }

  // Handle updating metafields for the group
  if (groupId && selectedMetafields) {
    const parsedMetafields = JSON.parse(selectedMetafields);
    await prisma.metafieldGroup.update({
      where: { id: groupId },
      data: { metafields: JSON.stringify(parsedMetafields) },
    });
    return json({ success: true });
  }

  return json({ error: "Name, deleteId or groupId is required" }, { status: 400 });
}

export default function Groups() {
  const initialGroups = useLoaderData();//get the loader data
  const fetcher = useFetcher();
  const [metafieldGroups, setMetafieldGroups] = useState(initialGroups);
  const [groupName, setGroupName] = useState('');
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [metafieldDefinitions, setMetafieldDefinitions] = useState([]);
  const [selectedMetafields, setSelectedMetafields] = useState([[]]);
  const [tempSelectedMetafields, setTempSelectedMetafields] = useState([]);
  const [updateIndex, setUpdateIndex] = useState(false);

  const handleGroupNameChange = (value) => setGroupName(value);

  useEffect(() => {

    if (!fetcher.data) return;

    if (fetcher.data.name && fetcher.data.id) {
      setMetafieldGroups((prevGroups) => {
        // Check if the group already exists before adding
        if (prevGroups.some((group) => group.id === fetcher.data.id)) {
          return prevGroups;
        }
        return [...prevGroups, fetcher.data];
      });
      setTempSelectedMetafields([]);
    }

    if (fetcher.data.success && fetcher.data.updatedGroup) {
      setMetafieldGroups((prevGroups) => {
        return prevGroups.map((group) =>
          group.id === fetcher.data.updatedGroup.id ? fetcher.data.updatedGroup : group
        );
      });
      setUpdateIndex(!updateIndex);
    }

    if (fetcher.data.deletedId) {
      setMetafieldGroups((prevGroups) =>
        prevGroups.filter((group) => group.id !== fetcher.data.deletedId)
      );

      setSelectedMetafields((prev) => {
        const updatedGroups = [...prev];
        if (fetcher.data.tabIndex !== undefined) {
          updatedGroups.splice(fetcher.data.tabIndex, 1);
        }
        return updatedGroups;
      });

      // setTempSelectedMetafields([]);
      setActiveTabIndex(0);
    }
  }, [fetcher.data]);

  useEffect(() => {
    initializeMetafields();
    // setTempSelectedMetafields(initializedMetafields[0] || []);
  }, []);

  useEffect(() => {
    // setTempSelectedMetafields(selectedMetafields[activeTabIndex] || []);
  }, [activeTabIndex, selectedMetafields]);


  const initializeMetafields = () => {
    if (metafieldGroups) {
      const newSelectedMetafields = metafieldGroups.map((group) => {
        const definitions = JSON.parse(group.metafields);
        return definitions.map((def) => ({
          id: def.id,
          name: def.name,
          namespace: def.namespace,
          key: def.key,
          type: def.type
        }));
      });
      setSelectedMetafields(newSelectedMetafields);
      return newSelectedMetafields;
    }
    return [];
  }


  const handleAddGroup = (event) => {
    event.preventDefault();
    const lowerCaseGroupName = groupName.toLowerCase();
    // Check if the group name already exists
    if (metafieldGroups.some((group) => group.name.toLowerCase() === lowerCaseGroupName)) {

      shopify.toast.show('This Group Name Already Exists');
      return;
    }
    fetcher.submit({ name: groupName }, { method: 'post' });
    setGroupName('');
  };

  const handleDeleteGroup = (id) => {
    fetcher.submit({ deleteId: id.toString() }, { method: 'post' });
    setSelectedMetafields((prev) => {
      const updated = [...prev];
      const groupIndex = metafieldGroups.findIndex((group) => group.id === id);
      if (groupIndex !== -1) {
        updated.splice(groupIndex, 1);
      }
      return updated;
    });
  };

  const tabs = metafieldGroups.map((group) => ({
    id: group.id,
    content: group.name,
  }));

  const handleTabChange = (index) => {
    console.log('handleTabChange is executed');
    console.log('Selected Metafields:', selectedMetafields);
    setActiveTabIndex(index);
    // setTempSelectedMetafields(selectedMetafields[index]);
  };

  // We need to use the groupId
  const handleAssignMetaFields = async (groupId) => {
    const response = await fetch("shopify:admin/api/graphql.json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `
          query {
            metafieldDefinitions(first: 100, ownerType: PRODUCT) {
              edges {
                node {
                  id
                  name
                  namespace
                  key
                  type {
                    valueType
                    name
                    category
                  }
                }
              }
            }
          }
        `,
      }),
    });

    const data = await response.json();
    const definitions = data.data.metafieldDefinitions.edges.map(edge => ({
      id: edge.node.id,
      key: edge.node.key,
      namespace: edge.node.namespace,
      type: edge.node.type,
      name: edge.node.name
    }));

    setMetafieldDefinitions(definitions);
    setModalOpen(true);
  };


  const handleCheckboxChange = (definition) => {
    setSelectedMetafields((prev) => {

      const updated = [...prev];

      // Ensure the array for the current tab exists
      if (!updated[activeTabIndex]) {
        updated[activeTabIndex] = [];
      }

      if (updated[activeTabIndex].map(data => data.id).includes(definition.id)) {
        updated[activeTabIndex] = updated[activeTabIndex].filter((item) => item.id !== definition.id);
      } else {
        updated[activeTabIndex] = [...updated[activeTabIndex], {
          id: definition.id,
          name: definition.name,
          namespace: definition.namespace,
          key: definition.key,
          type: definition.type
        }]
      }
      return updated;
    });
  };


  const handleAssign = () => {
    const metafieldData = selectedMetafields[activeTabIndex].map((data) => {
      // Find the definition corresponding to the selected metafield ID
      const definition = metafieldDefinitions.find((def) => def.id === data.id);
      return {
        id: data.id,
        name: definition?.name,
        namespace: definition?.namespace || "",
        key: definition?.key || "",
        type: {
          valueType: definition?.type?.valueType || "",
          name: definition?.type?.name
        },
      }
    });

    // Submit the selected metafields to be saved
    fetcher.submit(
      {
        metafields: JSON.stringify(metafieldData),
        groupId: metafieldGroups[activeTabIndex].id,
      },
      { method: 'post' }
    );

    setSelectedMetafields((prev) => {
      const updated = [...prev]
      if (!updated[activeTabIndex]) {
        updated[activeTabIndex] = []
      }
      updated[activeTabIndex] = metafieldData.map(data => ({
        id: data.id,
        name: data.name,
        namespace: data.namespace,
        key: data.key,
        type: data.type
      }));
      console.log("handleAssign is executed");
      console.log("Updated Selected Metafields: ", updated);
      return updated
    })
    // setTempSelectedMetafields(selectedMetafields[activeTabIndex]);
    setModalOpen(false);
  };


  return (
    <Page title="Metafield Group Manager">
      <Card sectioned>
        <form onSubmit={handleAddGroup}>
          <TextField
            label="New Group Name"
            value={groupName}
            onChange={handleGroupNameChange}
            placeholder="Enter group name, e.g., Post Purchase"
            name="name"
          />
          <Button submit primary disabled={!groupName}>
            Add Group
          </Button>
        </form>
      </Card>

      <Card sectioned title="Defined Metafield Groups">
        <Tabs
          tabs={tabs}
          selected={activeTabIndex}
          onSelect={handleTabChange}
        >
          {metafieldGroups?.map((group, index) => (
            <div key={group.id}>
              {activeTabIndex === index && (
                <div>
                  {/* Container for the buttons at the top */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <div>
                      <Button onClick={() => handleAssignMetaFields(group.id)}>
                        Assign Meta Fields
                      </Button>
                      <Button destructive onClick={() => handleDeleteGroup(group.id)} style={{ marginLeft: '8px' }}>
                        Delete
                      </Button>
                    </div>
                  </div>

                  {selectedMetafields[activeTabIndex] && selectedMetafields[activeTabIndex].length > 0 ? (
                    <SelectFreeGift groupId={group.id} associatedMetafields={selectedMetafields[activeTabIndex] || []} tabIndex={updateIndex} activeTabIndex={activeTabIndex} />
                  ) : (
                    <Text alignment='center'>No metafields are selected</Text>
                  )}
                </div>
              )}
            </div>
          ))}
        </Tabs>
      </Card>


      <Modal
        open={modalOpen}
        onClose={() => {
          // initializeMetafields();
          setModalOpen(false)
        }}
        title="Assign Metafields"
        primaryAction={{
          content: 'Assign',
          onAction: handleAssign,
        }}
      >
        <Modal.Section>
          <Card sectioned>
            <Text variant="headingMd" as="h2" >Assign Metafields for {metafieldGroups[activeTabIndex]?.name} </Text>
            <Layout>
              {metafieldDefinitions.map((definition) => (
                <Layout.Section key={definition.id} oneHalf>
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>

                    <Checkbox
                      label={definition.name}
                      checked={selectedMetafields[activeTabIndex]?.map(def => def.id).includes(definition.id)}
                      onChange={() => handleCheckboxChange(definition)}
                    />
                  </div>
                </Layout.Section>
              ))}
            </Layout>
          </Card>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

