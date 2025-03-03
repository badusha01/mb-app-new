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
  ButtonGroup,
} from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useEffect, useState } from "react";

function fetchProducts(searchTerm = "", afterCursor = null) {
  return fetch("shopify:admin/api/graphql.json", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: `
      query ($query: String, $after: String) {
        products(first: 10, query: $query, after: $after) {
          edges {
            cursor
            node {
              id
              title
              metafields(first: 10) {
                edges {
                  node {
                    id
                    key
                    value
                    type
                    reference {
                      ... on Product {
                        id
                        title
                        images(first: 10) {
                          edges {
                            node {
                              url
                            }
                          }
                        }
                      }
                    }
                    references(first: 10) {
                      edges {
                        node {
                          ... on Product {
                            id
                            title
                            images(first: 10) {
                              edges {
                                node {
                                  url
                                }
                              }
                            }
                          }
                        }
                      }
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
  })
    .then((res) => res.json())
    .then((data) => {
      console.log("Fetched Products with Metafields:", data.data.products.edges);
      return data;
    });
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
  // For list types we send an array (JSON) of ids; for single reference we send the single id.
  const variantReferences = metafieldData.type.name.includes("list")
    ? gifts.map((gift) => `${gift.id}`)
    : gifts.length > 0
      ? gifts[0].id
      : null; // if empty, clear it

  const variables = {
    input: {
      id: productId,
      metafields: [
        {
          namespace: metafieldData.namespace,
          key: metafieldData.key,
          value: metafieldData.type.name.includes("list")
            ? JSON.stringify(variantReferences)
            : variantReferences,
          type: metafieldData.type.name,
        },
      ],
    },
  };

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
        result.data.productUpdate.product.metafields.edges
      );
    } else {
      console.error(
        "Error updating metafield:",
        result.errors || result.data.productUpdate.userErrors
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
  const metafieldValue = value === null || value === "" ? "" : value;
  const variables = {
    input: {
      id: productId,
      metafields: [
        {
          namespace: activeMetafieldData.namespace,
          key: activeMetafieldData.key,
          value: metafieldValue,
          type: activeMetafieldData.type.name,
        },
      ],
    },
  };
  try {
    const response = await fetch("shopify:admin/api/graphql.json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    const responseData = await response.json();
    if (responseData.errors) {
      shopify.toast.show(`Error updating metafield: ${responseData.errors}`);
      console.log("Error updating metafield:", responseData.errors);
      return { success: false, errors: responseData.errors };
    } else if (responseData.data.productUpdate.userErrors.length > 0) {
      shopify.toast.show("User errors");
      return { success: false, userErrors: responseData.data.productUpdate.userErrors };
    } else {
      shopify.toast.show("Metafield updated successfully");
      const updatedMetafields = responseData.data.productUpdate.product.metafields.edges.map(
        (edge) => edge.node
      );
      return { success: true, metafields: updatedMetafields };
    }
  } catch (error) {
    console.error("Request failed:", error);
    return { success: false, errors: error.message };
  }
};

async function deleteMetafield(metafieldId) {
  const mutation = `
    mutation metafieldDelete($input: MetafieldDeleteInput!) {
      metafieldDelete(input: $input) {
        deletedId
        userErrors {
          field
          message
        }
      }
    }
  `;
  const variables = { input: { id: metafieldId } };
  try {
    const response = await fetch("shopify:admin/api/graphql.json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: mutation, variables }),
    });
    const result = await response.json();
    if (result.data?.metafieldDelete?.deletedId) {
      return { success: true, deletedId: result.data.metafieldDelete.deletedId };
    } else {
      console.error(
        "Error deleting metafield:",
        result.errors || result.data?.metafieldDelete?.userErrors
      );
      return { success: false, errors: result.errors || result.data?.metafieldDelete?.userErrors };
    }
  } catch (error) {
    console.error("Request failed:", error);
    return { success: false, errors: error.message };
  }
}

export default function SelectFreeGift({
  groupId,
  activeTabIndex,
  associatedMetafields,
}) {
  const app = useAppBridge();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedProductsByGroup, setSelectedProductsByGroup] = useState({});
  const [initialProductsByGroup, setInitialProductsByGroup] = useState({});
  const [hasChanges, setHasChanges] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [nextCursor, setNextCursor] = useState(null);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [selected, setSelected] = useState(""); // current metafield key
  const [saveButton, setSaveButton] = useState({});
  const [disabledSaveButton, setDisabledSaveButton] = useState({});
  const [deleteButtonLoading, setDeleteButtonLoading] = useState({});
  const [disabledDeleteButton, setDisabledDeleteButton] = useState({});
  const [textInput, setTextInput] = useState({});
  const [isProductMetafield, setIsProductMetafield] = useState(false);

  // Load products and build an object mapping each metafield key → entries.
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
        variants: product.variants?.edges?.map((variant) => ({
          id: variant.node.id,
          title: variant.node.title,
          image: variant.node.image ? variant.node.image.originalSrc : null,
        })),
        prePopulatedVariants,
        metafields: product.metafields?.edges?.map((m) => {
          const metafield = m.node;
          let referenceProducts = [];
          if (metafield.reference) {
            referenceProducts.push({
              id: metafield.reference.id,
              title: metafield.reference.title,
              images: metafield.reference.images.edges.map((img) => img.node.url),
            });
          }
          if (metafield.references) {
            referenceProducts = metafield.references.edges.map((refEdge) => ({
              id: refEdge.node.id,
              title: refEdge.node.title,
              images: refEdge.node.images.edges.map((img) => img.node.url),
            }));
          }
          return {
            id: metafield.id,
            key: metafield.key,
            value: metafield.value,
            type: metafield.type,
            referenceProducts,
          };
        }) || [],
        cursor: edge.cursor,
      };
    });

    // Build text input values.
    const newTextInputValues = {};
    formattedProducts.forEach((product) => {
      product.metafields.forEach((metafield) => {
        if (!newTextInputValues[metafield.key]) {
          newTextInputValues[metafield.key] = {};
        }
        newTextInputValues[metafield.key][product.id] = metafield.value || "";
      });
    });

    // Build an object mapping each metafield key to its array of entries.
    const newSelectedProductsObj = {};
    // When processing each product in loadProducts:
    formattedProducts.forEach((product) => {
      product.metafields.forEach((metafield) => {
        let selections = [];
        // For list metafields stored as JSON strings, parse the value.
        if (
          associatedMetafields.find((m) => m.key === metafield.key)?.type.name.includes("list") &&
          metafield.value
        ) {

          try {
            const parsedIds = JSON.parse(metafield.value);
            selections = parsedIds.map((id) => {
              // Find the product details from referenceProducts that match this id.
              const productDetail = metafield.referenceProducts.find((ref) => ref.id === id);
              console.log("product details:", productDetail);

              return {
                id,
                title: productDetail ? productDetail.title : "Product",
                images: productDetail ? productDetail.images[0] : [],
              };
            });
            // console.log("Parsed Id:", metafield);
          } catch (e) {
            console.error("Failed to parse metafield value", e);
          }
        }
        // For non-list metafields, use referenceProducts from the query.
        else if (metafield.referenceProducts && metafield.referenceProducts.length > 0) {
          selections = metafield.referenceProducts.map((refProd) => ({
            id: refProd.id,
            title: refProd.title,
            images: refProd.images,
          }));
        }

        if (selections.length > 0) {
          if (!newSelectedProductsObj[metafield.key]) {
            newSelectedProductsObj[metafield.key] = [];
          }
          newSelectedProductsObj[metafield.key].push({
            productId: product.id,
            selections,
          });
        }
      });
    });


    console.log("formattedProducts", formattedProducts);
    console.log("newSelectedProductsObj", newSelectedProductsObj);

    setProducts(append ? [...products, ...formattedProducts] : formattedProducts);
    setTextInput(append ? { ...textInput, ...newTextInputValues } : newTextInputValues);
    // setSelectedProductsByGroup((prev) => ({
    //   ...prev,
    //   [activeTabIndex]:
    //     append && prev[activeTabIndex]
    //       ? { ...prev[activeTabIndex], ...newSelectedProductsObj }
    //       : newSelectedProductsObj,
    // }));
    // setInitialProductsByGroup((prev) => ({
    //   ...prev,
    //   [activeTabIndex]:
    //     append && prev[activeTabIndex]
    //       ? { ...prev[activeTabIndex], ...newSelectedProductsObj }
    //       : newSelectedProductsObj,
    // }));

    setSelectedProductsByGroup((prev) => {
      const current = prev[activeTabIndex] || {};
      const merged = { ...current };

      Object.keys(newSelectedProductsObj).forEach((key) => {
        merged[key] = current[key]
          ? [...current[key], ...newSelectedProductsObj[key]]
          : newSelectedProductsObj[key];
      });

      return {
        ...prev,
        [activeTabIndex]: merged,
      };
    });

    setInitialProductsByGroup((prev) => {
      const current = prev[activeTabIndex] || {};
      const merged = { ...current };

      Object.keys(newSelectedProductsObj).forEach((key) => {
        merged[key] = current[key]
          ? [...current[key], ...newSelectedProductsObj[key]]
          : newSelectedProductsObj[key];
      });

      return {
        ...prev,
        [activeTabIndex]: merged,
      };
    });


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
  }, [searchTerm, activeTabIndex]);

  useEffect(() => {
    console.log("Updated selectedProductsByGroup:", selectedProductsByGroup);
  }, [selectedProductsByGroup, activeTabIndex]);

  useEffect(() => {
    if (associatedMetafields && associatedMetafields.length > 0) {
      setSelected(associatedMetafields[0].key);
      const sel = associatedMetafields[0];
      const isProd =
        sel?.type?.name === "list.product_reference" ||
        sel?.type?.name === "product_reference";
      setIsProductMetafield(isProd);
    }
  }, [associatedMetafields]);

  useEffect(() => {
    console.log("activeTabIndex:", activeTabIndex);
  }, [activeTabIndex]);


  useEffect(() => {
    console.log("selectedProductsByGroup updated:", selectedProductsByGroup);
  }, [selectedProductsByGroup]);

  const loadNextPage = () => {
    if (hasNextPage) loadProducts(nextCursor, true);
  };

  const handleSearchChange = (value) => {
    setSearchTerm(value);
  };




  const handleSubmit = async (event) => {
    event.preventDefault();
    const activeMetafieldData = associatedMetafields.find(
      (metafield) => metafield.key === selected
    );
    const groupData = selectedProductsByGroup[activeTabIndex] || {};
    const groupSelected = groupData[selected] || [];
    const groupInitial = (initialProductsByGroup[activeTabIndex] || {})[selected] || [];

    // Create a lookup for the current selections
    const selectedMap = {};
    groupSelected.forEach((entry) => {
      selectedMap[entry.productId] = entry;
    });

    // For products that were initially selected but are now missing
    for (const initialEntry of groupInitial) {
      if (!selectedMap[initialEntry.productId]) {
        if (!activeMetafieldData.type.name.includes("list")) {
          // Single product reference: delete the metafield
          const product = products.find((product) => product.id === initialEntry.productId);
          const metafield = product?.metafields?.find((m) => m.key === selected);
          if (metafield) {
            await deleteMetafield(metafield.id);
          }
        } else {
          // List product reference: update with an empty array
          await updateMetafield(initialEntry.productId, [], activeMetafieldData);
        }
      }
    }

    // For products that are still selected, update only if there are changes
    for (const entry of groupSelected) {
      const productId = entry.productId;
      const initialEntry = groupInitial.find((item) => item.productId === productId);
      const currentSelections = entry.selections;
      const initialSelections = initialEntry ? initialEntry.selections : [];
      if (JSON.stringify(currentSelections) !== JSON.stringify(initialSelections)) {
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
    const multiple = metafieldType.includes("list");
    const group = selectedProductsByGroup[activeTabIndex] || {};
    const currentEntries = group[selected] || [];
    const entry = currentEntries.find((e) => e.productId === productId);
    const entryIDs = entry ? entry.selections.map((item) => ({ id: item.id })) : [];

    console.log("Entry:", entry);
    console.log("ENIDS:", entryIDs);

    const pickerResult = await app.resourcePicker({
      type: "product",
      filter: { variants: false },
      multiple,
      selectionIds: entryIDs,
    });

    console.log("PickerResult:", pickerResult);

    // Update state if pickerResult is defined
    if (pickerResult && pickerResult.selection) {
      setSelectedProductsByGroup((prev) => {
        const group = prev[activeTabIndex] || {};
        const currentEntries = group[selected] || [];
        const idx = currentEntries.findIndex((entry) => entry.productId === productId);

        // If no items are selected, remove the entry entirely
        if (pickerResult.selection.length === 0) {
          const newEntries = currentEntries.filter((entry) => entry.productId !== productId);
          setHasChanges(true);
          return {
            ...prev,
            [activeTabIndex]: {
              ...group,
              [selected]: newEntries,
            },
          };
        }

        let newEntry;
        if (!metafieldType.includes("list")) {
          // For single product reference, override with the first selection.
          newEntry = {
            productId,
            selections: [
              {
                id: pickerResult.selection[0].id,
                title: pickerResult.selection[0].title,
                image: pickerResult.selection[0].images[0]?.src,
                isVariant: false,
              },
            ],
          };
        } else {
          // For list type, override current selections with the new picker selection.
          newEntry = {
            productId,
            selections: pickerResult.selection.map((item) => ({
              id: item.id,
              title: item.title,
              image: item.images[0]?.src,
              isVariant: false,
            })),
          };
        }

        const newEntries =
          idx !== -1
            ? currentEntries.map((entry) => (entry.productId === productId ? newEntry : entry))
            : [...currentEntries, newEntry];

        setHasChanges(true);
        return {
          ...prev,
          [activeTabIndex]: {
            ...group,
            [selected]: newEntries,
          },
        };
      });
    }
  };




  const removeProduct = async (productId, selectedItemId) => {
    // Update the selectedProductsByGroup state as before
    setSelectedProductsByGroup((prev) => {
      const group = prev[activeTabIndex] || {};
      const currentEntries = group[selected] || [];
      const entryIndex = currentEntries.findIndex((entry) => entry.productId === productId);

      if (entryIndex !== -1) {
        let newEntries;
        const selectedMetafield = associatedMetafields.find((m) => m.key === selected);

        if (!selectedMetafield?.type?.name.includes("list")) {
          // For single product reference - remove the entire entry
          newEntries = currentEntries.filter((entry) => entry.productId !== productId);
        } else {
          // For list-type metafields, remove only the specific selected item
          const updatedSelections = currentEntries[entryIndex].selections.filter(
            (item) => item.id !== selectedItemId
          );
          newEntries = currentEntries.map((entry) =>
            entry.productId === productId ? { productId, selections: updatedSelections } : entry
          );
        }
        setHasChanges(true);
        return {
          ...prev,
          [activeTabIndex]: {
            ...group,
            [selected]: newEntries,
          },
        };
      }
      return prev;
    });

    // Retrieve the correct metafield instance ID from the product's metafields
    const productData = products.find((product) => product.id === productId);
    if (!productData) return;

    const productMetafield = productData.metafields.find((m) => m.key === selected);
    if (productMetafield && productMetafield.id) {
      if (!productMetafield.id.startsWith("gid://shopify/Metafield/")) {
        console.error("Invalid metafield ID format:", productMetafield.id);
        return;
      }
      try {
        console.log(`Deleting metafield with ID: ${productMetafield.id}`);
        const response = await deleteMetafield(productMetafield.id);
        console.log("Metafield deletion response:", response);
        if (response.errors) {
          console.error("Shopify API Error:", response.errors);
        } else {
          console.log("Metafield deleted successfully");
        }
      } catch (error) {
        console.error("Error deleting metafield:", error);
      }
    }
  };



  const toggleSaveButtonState = (id, state) => {
    setDisabledSaveButton((prev) => ({
      ...prev,
      [id]: state,
    }));
  };

  const toggleSaveButtonLoading = (id, state) => {
    setSaveButton((prev) => ({
      ...prev,
      [id]: state,
    }));
  };

  const toggleDeleteButtonState = (id, state) => {
    setDisabledDeleteButton((prev) => ({
      ...prev,
      [id]: state,
    }));
  };


  const toggleDeleteButtonLoading = (id, state) => {
    setDeleteButtonLoading((prev) => ({
      ...prev,
      [id]: state,
    }));
  };

  const handleTextChange = (id, textValue, key) => {
    toggleSaveButtonState(id, false);
    toggleDeleteButtonState(id, false);
    setTextInput((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] || {}),
        [id]: textValue || "",
      },
    }));
  };


  const handleDeleteDescription = async (productId, key) => {
    const product = products.find((product) => product.id === productId);
    const metafield = product?.metafields?.find((m) => m.key === key);

    if (metafield) {
      toggleDeleteButtonLoading(productId, true); // Show loading state for Delete button
      const deleteResult = await deleteMetafield(metafield.id);

      if (deleteResult.success) {
        // Update products state by removing the deleted metafield
        setProducts((prevProducts) =>
          prevProducts.map((product) =>
            product.id === productId
              ? {
                ...product,
                metafields: product.metafields.filter((m) => m.id !== deleteResult.deletedId),
              }
              : product
          )
        );
        // Clear the text input for this product and metafield
        setTextInput((prev) => ({
          ...prev,
          [key]: {
            ...(prev[key] || {}),
            [productId]: "",
          },
        }));
        app.toast.show("Metafield deleted successfully");
        toggleDeleteButtonState(productId, true); // Disable Delete button after successful deletion
      } else {
        console.error("Failed to delete metafield:", deleteResult.errors);
        app.toast.show("Failed to delete metafield");
        toggleDeleteButtonState(productId, false); // Keep enabled if deletion fails
      }
      toggleDeleteButtonLoading(productId, false); // Reset loading state for Delete button
    }
  };

  const handleSaveDescription = async (productId, key) => {
    toggleSaveButtonLoading(productId, true);
    let textFieldValue = textInput[key][productId];
    const activeMetafieldData = associatedMetafields.find(
      (metafield) => metafield.key === key
    );
    let result;

    if (textFieldValue === "") {
      const product = products.find((product) => product.id === productId);
      const metafield = product?.metafields?.find((m) => m.key === key);
      if (metafield) {
        const deleteResult = await deleteMetafield(metafield.id);
        if (deleteResult.success) {
          // Update products state by removing the deleted metafield
          setProducts((prevProducts) =>
            prevProducts.map((product) =>
              product.id === productId
                ? {
                  ...product,
                  metafields: product.metafields.filter((m) => m.id !== deleteResult.deletedId),
                }
                : product
            )
          );
          result = true;
        } else {
          console.error("Failed to delete metafield:", deleteResult.errors);
          result = false;
        }
      } else {
        // No metafield to delete, treat as success
        result = true;
      }
    } else {
      const updateResult = await updateProductMetafield(
        productId,
        textFieldValue,
        activeMetafieldData
      );
      if (updateResult.success) {
        // Update products state with the new metafields
        setProducts((prevProducts) =>
          prevProducts.map((product) =>
            product.id === productId
              ? {
                ...product,
                metafields: updateResult.metafields,
              }
              : product
          )
        );
        result = true;
      } else {
        console.error("Failed to update metafield:", updateResult.errors || updateResult.userErrors);
        result = false;
      }
    }

    toggleSaveButtonState(productId, result);
    toggleSaveButtonLoading(productId, false); // Reset loading state regardless of result
  };


  const handleSelectChange = (value) => {
    setSelected(value);
    const selectedMetafield = associatedMetafields.find((metafield) => metafield.key === value);
    const isProd =
      selectedMetafield?.type?.name === "list.product_reference" ||
      selectedMetafield?.type?.name === "product_reference";
    setIsProductMetafield(isProd);
  };

  const options = associatedMetafields?.map((group) => ({
    label: group.name,
    value: group.key,
    type: group.type,
  }));

  return (
    <Frame>
      <Page title="Configure Free Gifts">
        {associatedMetafields && (
          <>
            <Select label="Select Metafield" options={options} onChange={handleSelectChange} value={selected} />
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
                      console.log("rendering item", item);
                      const { id, title } = item;
                      const groupData = selectedProductsByGroup[activeTabIndex] || {};
                      const currentEntries = groupData[selected] || [];
                      const entry = currentEntries.find((e) => e.productId === id);
                      const selectedItems = entry ? entry.selections : [];
                      const metafieldKey = selected;
                      const selectedMetafield = options.find((option) => option.value === selected);
                      console.log("Selected Items:", selectedItems);
                      console.log("selected Products by group:", selectedProductsByGroup[activeTabIndex])
                      console.log("selected group data", currentEntries)
                      const inputValue = textInput[metafieldKey]?.[id] || "";
                      return (
                        <ResourceItem id={id} accessibilityLabel={`View details for ${title}`}>
                          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                            <Text as="span" variant="bodyMd" fontWeight="bold">
                              {title}
                            </Text>
                            {selectedMetafield?.type?.name === "single_line_text_field" ||
                              selectedMetafield?.type?.name === "multi_line_text_field" ? (
                              <>
                                <TextField
                                  label={`Enter ${selectedMetafield.label}`}
                                  value={inputValue}
                                  onChange={(val) => handleTextChange(id, val, metafieldKey)}
                                  multiline={
                                    selectedMetafield?.type?.name === "multi_line_text_field" ? 5 : undefined
                                  }
                                  autoComplete="off"
                                />
                                <ButtonGroup>
                                  <Button
                                    variant="primary"
                                    onClick={() => handleSaveDescription(id, metafieldKey)}
                                    disabled={disabledSaveButton[id]}
                                    loading={saveButton[id]}
                                  >
                                    Save
                                  </Button>
                                  <Button
                                    variant="secondary"
                                    destructive
                                    onClick={() => handleDeleteDescription(id, metafieldKey)}
                                    disabled={disabledDeleteButton[id]}
                                    loading={deleteButtonLoading[id]}
                                  >
                                    Delete
                                  </Button>
                                </ButtonGroup>
                              </>
                            ) : (
                              <Button onClick={() => openResourcePicker(id, selectedMetafield?.type?.name)}>
                                Select Product/Variant
                              </Button>
                            )}
                            {isProductMetafield && selectedItems.length > 0 && (
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
                                    <Thumbnail source={item.image || ""} alt={item.title} size="small" />
                                    <Text as="span" variant="bodySm" style={{ marginLeft: "8px" }}>
                                      {item.isVariant ? `${item.productTitle} - ${item.title}` : item.title}
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
            {hasNextPage && !loading && <Button onClick={loadNextPage} fullWidth>Load more products</Button>}
          </>
        )}
      </Page>
      <div style={{ marginTop: "15px" }}></div>
      {hasChanges && (
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
      )}
    </Frame>
  );
}



