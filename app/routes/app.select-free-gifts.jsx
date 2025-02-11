import {
  Page,
  Card,
  ResourceList,
  ResourceItem,
  Text,
  Button,
  Spinner,
  Thumbnail,
  Frame,
  TextField,
  Select,
  ButtonGroup
} from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import { act, useEffect, useState } from "react";
import { isVariableDeclaration } from "typescript";

function fetchProducts(searchTerm = "", afterCursor = null) {
  return fetch("shopify:admin/api/graphql.json", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: `
        query ($query: String, $after: String) {
          products(first: 5, query: $query, after: $after) {
            edges {
              cursor
              node {
                id
                title
                metafields (first: 10) {
                  edges {
                    node {
                      id
                      key
                      value
                    }
                  }
                }
                variants(first: 5) {
                  edges {
                    node {
                      id
                      title
                      image {
                        originalSrc
                      }
                    }
                  }
                }
              }
            }
            pageInfo {
              hasNextPage
            }
          }
        }
      `,
      variables: {
        query: searchTerm ? `title:*${searchTerm}*` : "",
        after: afterCursor,
      },
    }),
  }).then((res) => res.json());
}

async function updateMetafield(productId, gifts, metafieldData) {
  const mutation = `
    mutation updateProductMetafield($input: ProductInput!) {
      productUpdate(input: $input) {
        product {
          id
          metafields(first: 10) {
            edges {
              node {
                id
                namespace
                key
                value
              }
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;


  const variantReferences = metafieldData.type.name.includes('list') ?
    gifts.map((gift) => `${gift.id}`) :
    gifts[0].id;

  const variables = {
    input: {
      id: productId,
      metafields: [
        {
          namespace: metafieldData.namespace,
          key: metafieldData.key,
          value: metafieldData.type.name.includes('list') ? JSON.stringify(variantReferences) : variantReferences,
          type: metafieldData.type.name,
        },
      ],
    },
  }


  try {
    const response = await fetch("shopify:admin/api/graphql.json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: mutation, variables }),
    });
    const result = await response.json();
    if (result.data && result.data.productUpdate) {
      console.log(
        "Metafield updated successfully:",
        result.data.productUpdate.product.metafields.edges,
      );
    } else {
      console.error(
        "Error updating metafield:",
        result.errors || result.data.productUpdate.userErrors,
      );
    }
  } catch (error) {
    console.error("Request failed:", error);
  }
}


const updateProductMetafield = async (productId, value, activeMetafieldData) => {
  const query = `
    mutation updateProductMetafield($input: ProductInput!) {
      productUpdate(input: $input) {
        product {
          id
          metafields(first: 10) {
            edges {
              node {
                id
                namespace
                key
                value
                type
              }
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = {
    input: {
      id: productId,
      metafields: [
        {
          namespace: activeMetafieldData.namespace,
          key: activeMetafieldData.key,
          value: value,
          type: activeMetafieldData.type.name
        },
      ],
    },
  }

  const response = await fetch("shopify:admin/api/graphql.json", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });

  const responseData = await response.json();
  // console.log("ResponseData:", responseData);

  if (responseData.errors) {
    shopify.toast.show(`Error updating metafield: ${responseData.errors}`);
    console.log("Error updating metafield:", responseData.errors);
  } else if (responseData.data.productUpdate.userErrors.length > 0) {
    shopify.toast.show("User errors");
  } else {
    shopify.toast.show("Metafield updated successfully");
  }

  return true;

}

export default function SelectFreeGift({
  groupId,
  activeTabIndex,
  associatedMetafields
}) {
  const app = useAppBridge();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedProductsByRow, setSelectedProductsByRow] = useState({});
  const [initialProductsByRow, setInitialProductsByRow] = useState({});
  const [hasChanges, setHasChanges] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [nextCursor, setNextCursor] = useState(null);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [value, setValue] = useState("");
  const [selected, setSelected] = useState("");
  const [saveButton, setSaveButton] = useState({});
  const [disabledSaveButton, setDisabledSaveButton] = useState({});
  const [textInput, setTextInput] = useState({});

  const loadProducts = async (afterCursor = null, append = false) => {
    setLoading(true);
    const data = await fetchProducts(searchTerm, afterCursor);

    const formattedProducts = data.data.products.edges.map((edge) => {
      const product = edge.node;
      const giftVariantsMetafield = product.metafields?.edges?.find(
        (metafield) => metafield.node.key === "recommendations"
      );

      const prePopulatedVariants = giftVariantsMetafield
        ? JSON.parse(giftVariantsMetafield.node.value).map((variantId) => ({
          id: variantId,
          title: "Gift Variant",
          productTitle: product.title,
          isVariant: true,
        }))
        : [];

      return {
        id: product.id,
        title: product.title,
        variants: product.variants.edges.map((variant) => ({
          id: variant.node.id,
          title: variant.node.title,
          image: variant.node.image ? variant.node.image.originalSrc : null,
        })),
        prePopulatedVariants,
        metafields: product.metafields?.edges?.map((m) => m.node) || [], // Ensure metafields is always an array
        cursor: edge.cursor,
      };
    });

    const newTextInputValues = {};
    formattedProducts.forEach((product) => {
      product.metafields.forEach((metafield) => {
        if (!newTextInputValues[metafield.key]) {
          newTextInputValues[metafield.key] = {};
        }
        newTextInputValues[metafield.key][product.id] = metafield.value || "";
      });
    });

    setProducts((prevProducts) =>
      append ? [...prevProducts, ...formattedProducts] : formattedProducts
    );

    setTextInput((prev) =>
      append ? { ...prev, ...newTextInputValues } : newTextInputValues
    );

    setHasNextPage(data.data.products.pageInfo.hasNextPage);
    setNextCursor(
      data.data.products.pageInfo.hasNextPage
        ? data.data.products.edges[data.data.products.edges.length - 1].cursor
        : null
    );
    setLoading(false);
  };


  useEffect(() => {
    loadProducts();
  }, [searchTerm]);


  useEffect(() => {
    if (associatedMetafields && associatedMetafields.length > 0) {
      setSelected(associatedMetafields[0].key);
    }
  }, [associatedMetafields]);

  const loadNextPage = () => {
    if (hasNextPage) loadProducts(nextCursor, true);
  };

  const handleSearchChange = (value) => {
    setSearchTerm(value);
  };

  const handleChange = (value) => {
    setValue(value);
  };

  console.log("SELECTED:", selected);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const activeMetafieldData = associatedMetafields.find(metafield => metafield.key == selected);
    for (const productId in selectedProductsByRow) {
      const currentSelections = selectedProductsByRow[productId];
      const initialSelections = initialProductsByRow[productId] || [];

      if (
        JSON.stringify(currentSelections) !== JSON.stringify(initialSelections)
      ) {
        const selectedGifts = currentSelections.map((item) => ({
          id: item.id,
          title: item.title,
        }));
        await updateMetafield(productId, selectedGifts, activeMetafieldData);
      }
    }
    setHasChanges(false);
    console.log("Metafields updated for changed products.");
  };
  const openResourcePicker = async (productId, metafieldType) => {
    const pickerResult = await app.resourcePicker({
      type: "product",
      showVariants: false,
      multiple: metafieldType === "list.product_reference" || metafieldType === "product_reference" ?
        metafieldType === "list.product_reference" : false
    });

    if (
      pickerResult &&
      pickerResult.selection &&
      pickerResult.selection.length > 0
    ) {
      setSelectedProductsByRow((prev) => {
        const existingSelections = prev[productId] || [];

        const newSelections = pickerResult.selection.flatMap((item) => {
          return {
            id: item.id,
            title: item.title,
            image: item.images[0]?.src,
            isVariant: false,
          };
        });


        const combinedSelections = [...existingSelections, ...newSelections];
        const uniqueSelections = Array.from(
          new Map(combinedSelections.map((item) => [item.id, item])).values()
        );


        setHasChanges(true);
        return {
          ...prev,
          [productId]: uniqueSelections,
        };
      });
    }
  };

  const removeProduct = (productId, selectedItemId) => {
    setSelectedProductsByRow((prev) => {
      const updatedSelections = prev[productId].filter(
        (item) => item.id !== selectedItemId,
      );
      setHasChanges(true);
      return {
        ...prev,
        [productId]: updatedSelections,
      };
    });
  };

  const toggleSaveButtonState = (id, state) => {
    setDisabledSaveButton((prev) => ({
      ...prev, [id]: state
    }))
  }

  const toggleSaveButtonLoading = (id, state) => {
    setSaveButton((prev) => ({
      ...prev, [id]: state,
    }))
  }

  const handleTextChange = (id, textValue, key) => {
    toggleSaveButtonState(id, false);
    setTextInput((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] || {}),
        [id]: textValue,
      }
    }))
  };

  const handleSaveDescription = async (productId, key) => {
    toggleSaveButtonLoading(productId, true);
    const textFieldValue = textInput[key][productId] || '';
    const activeMetafieldData = associatedMetafields.find(metafield => metafield.key === key);
    const result = await updateProductMetafield(productId, textFieldValue, activeMetafieldData);
    toggleSaveButtonState(productId, result);
    toggleSaveButtonLoading(productId, !result);
  }

  // const handleCancel = (id) => {

  // };

  const handleSelectChange = (value) => {
    setSelected(value);
  };


  const options = associatedMetafields?.map((group) => ({
    label: group.name,
    value: group.key,
    type: group.type
  }));

  return (
    <Frame>

      <Page title="Configure Free Gifts">

        {associatedMetafields &&
          <>
            <Select
              label="Select Metafield"
              options={options}
              onChange={handleSelectChange}
              value={selected}
            />
            <TextField
              label="Search Products"
              value={searchTerm}
              onChange={handleSearchChange}
              placeholder="Search by product title"
              clearButton
              onClearButtonClick={() => setSearchTerm("")}
            />

            <form onSubmit={handleSubmit}>
              <Card>
                {loading ? (
                  <Spinner accessibilityLabel="Loading products" size="large" />
                ) : (
                  <ResourceList
                    resourceName={{ singular: "product", plural: "products" }}
                    items={products}
                    renderItem={(item) => {
                      const { id, title } = item;
                      const selectedItems = selectedProductsByRow[id] || [];
                      const metafieldKey = selected;
                      const selectedMetafield = options.find((option) => option.value === selected);
                      console.log("Selected Metafield: ", selectedMetafield);
                      const inputValue = textInput[metafieldKey]?.[id] || "";

                      return (
                        <ResourceItem
                          id={id}
                          accessibilityLabel={`View details for ${title}`}
                        >
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: "10px",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                              }}
                            >
                              <Text as="span" variant="bodyMd" fontWeight="bold">
                                {title}
                              </Text>
                              {selectedMetafield?.type?.name == "single_line_text_field" || selectedMetafield?.type?.name == "multi_line_text_field" ? (
                                <>
                                  <TextField
                                    label={`Enter ${selectedMetafield.label}`}
                                    value={inputValue}
                                    onChange={(val) => handleTextChange(id, val, metafieldKey)}
                                    multiline={selectedMetafield?.type?.name === "multi_line_text_field" ? 5 : undefined}
                                    autoComplete="off"
                                  />
                                  <ButtonGroup>
                                    {/* <Button onClick={() => handleCancel(id)}>Cancel</Button> */}
                                    <Button
                                      variant="primary"
                                      onClick={() => handleSaveDescription(id, metafieldKey)}
                                      disabled={disabledSaveButton[id]}
                                      loading={saveButton[id]}
                                    >
                                      Save
                                    </Button>
                                  </ButtonGroup>
                                </>
                              ) : (
                                <Button onClick={() => openResourcePicker(id, selectedMetafield?.type?.name)}>Select Product/Variant</Button>
                              )}
                            </div>
                            {selectedItems.length > 0 && (
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "8px",
                                  padding: "8px",
                                  border: "1px solid #d3d3d3",
                                  borderRadius: "4px",
                                  backgroundColor: "#f6f6f7",
                                  flexWrap: "wrap",
                                }}
                              >
                                {console.log("Selected Items", selectedItems)}
                                {selectedItems.map((item) => (
                                  <div
                                    key={item.id}
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      padding: "3px 6px",
                                      borderRadius: "3px",
                                      backgroundColor: "#e1e3e5",
                                      margin: "2px",
                                    }}
                                  >
                                    <Thumbnail
                                      source={item.image || ""}
                                      alt={item.title}
                                      size="small"
                                    />
                                    <Text
                                      as="span"
                                      variant="bodySm"
                                      style={{ marginLeft: "8px" }}
                                    >
                                      {item.isVariant
                                        ? `${item.productTitle} - ${item.title}`
                                        : item.title}
                                    </Text>
                                    <Button
                                      plain
                                      destructive
                                      onClick={() => removeProduct(id, item.id)}
                                      style={{ marginLeft: "8px" }}
                                    >
                                      ×
                                    </Button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </ResourceItem>
                      );
                    }}
                  />
                )}
              </Card>
            </form>
            {hasNextPage && !loading && (
              <Button onClick={loadNextPage} fullWidth>
                Load more products
              </Button>
            )}

          </>}
      </Page>


      <div
        style={{
          marginTop: "15px",
        }}
      ></div>



      {
        hasChanges && (
          <div
            style={{
              position: "fixed",
              bottom: "0",
              width: "100%",
              backgroundColor: "#6fe8c0",
              padding: "10px",
              borderTop: "1px solid #d3d3d3",
            }}
          >
            <Button primary onClick={handleSubmit}>
              Save Changes
            </Button>
          </div>
        )
      }
    </Frame >
  );
}
