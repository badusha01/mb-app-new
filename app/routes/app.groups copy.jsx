import prisma from './../db.server';
import { json } from '@remix-run/node';
import { useLoaderData, useFetcher } from '@remix-run/react';
import { useState, useEffect } from 'react';
import { Page, Card, TextField, Button, ResourceList, ResourceItem, Text ,Tabs,Modal,Checkbox,Layout} from '@shopify/polaris';

export async function loader() {
  const groups = await prisma.metafieldGroup.findMany();
  return json(groups);
}

export async function action({ request }) {
  const formData = await request.formData();
  const name = formData.get('name');
  const deleteId = formData.get('deleteId');

  if (deleteId) {
    await prisma.metafieldGroup.delete({
      where: { id: deleteId },
    });
    return json({ success: true, deletedId: deleteId });
  }

  if (name) {
    const newGroup = await prisma.metafieldGroup.create({
      data: { name, metafields: JSON.stringify([]) },
    });
    return json(newGroup);
  }

  return json({ error: "Name or deleteId is required" }, { status: 400 });
}

export default function Groups() {
  const initialGroups = useLoaderData();
  const fetcher = useFetcher();
  const [metafieldGroups, setMetafieldGroups] = useState(initialGroups);
  const [groupName, setGroupName] = useState('');
  const [activeTabIndex, setActiveTabIndex] = useState(0); // State to manage active tab

  const [modalOpen, setModalOpen] = useState(false);
  const [metafieldDefinitions, setMetafieldDefinitions] = useState([]);
  const [selectedMetafields, setSelectedMetafields] = useState([]);

  const handleGroupNameChange = (value) => setGroupName(value);

  useEffect(() => {
    // Check if a new group has been created in the response and update state
    if (fetcher.data && fetcher.data.name && fetcher.data.id) {
      setMetafieldGroups((prevGroups) => [
        ...prevGroups,
        fetcher.data // Add the new group with the actual ID from the database
      ]);
    }

    // Check if a group has been deleted in the response and update state
    if (fetcher.data && fetcher.data.deletedId) {
      setMetafieldGroups((prevGroups) =>
        prevGroups.filter((group) => group.id !== fetcher.data.deletedId)
      );
    }
  }, [fetcher.data]);

  const handleAddGroup = (event) => {
    event.preventDefault();
    fetcher.submit({ name: groupName }, { method: 'post' });
    setGroupName('');
  };

  const handleDeleteGroup = (id) => {
    fetcher.submit({ deleteId: id.toString() }, { method: 'post' });
  };

  const tabs = metafieldGroups.map((group) => ({
    id: group.id,
    content: group.name,
  }));

  const handleAssign = () => {
    // Logic to assign selected metafields to the group
    console.log("Assigning metafields:", selectedMetafields);
    setModalOpen(false);
    setSelectedMetafields([]);
  };


  const handleTabChange = (index) => {
    setActiveTabIndex(index);
  };

  const handleAssignMetaFields = async (groupId) => {
    // Fetch metafield definitions from the GraphQL API
    const response = await fetch("shopify:admin/api/graphql.json", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `
          query {
            metafieldDefinitions(first: 100,ownerType: PRODUCT) {
              edges {
                node {
                  id
                  namespace
                  key
                  type {
                   valueType
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
        type: edge.node.type.valueType,  // Assuming you want to use the name field
      }));

      setMetafieldDefinitions(definitions);
      setModalOpen(true);
  };

  const handleCheckboxChange = (id) => {
    setSelectedMetafields((prev) => 
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
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
          {metafieldGroups.map((group, index) => (
            <div key={group.id}>
              {activeTabIndex === index && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text variant="bodyMd" fontWeight="bold">{group.name}</Text>
                  <Button onClick={() => handleAssignMetaFields(group.id)}>
                      Assign Meta Fields
                    </Button>
                  <Button destructive onClick={() => handleDeleteGroup(group.id)}>
                    Delete
                  </Button>
                </div>
              )}
            </div>
          ))}
        </Tabs>
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Assign Metafields"
        primaryAction={{
          content: 'Assign',
          onAction: handleAssign,
        }}
      >
       <Modal.Section>
  <Card sectioned>
    <Text variant="headingMd" as="h2">Assign Metafields</Text>
    <Layout>
      {metafieldDefinitions.map((definition) => (
        <Layout.Section key={definition.id} oneHalf>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
            <Checkbox
              label={definition.key}
              checked={selectedMetafields.includes(definition.id)}
              onChange={() => handleCheckboxChange(definition.id)}
            />
            <Text variant="bodySm" style={{ marginLeft: '8px' }}>{`Namespace: ${definition.namespace}`}</Text>
            <Text variant="bodySm" style={{ marginLeft: '8px' }}>{`Type: ${definition.type}`}</Text>
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
